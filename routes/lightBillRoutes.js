// const express = require("express");
// const router = express.Router();
// const { createLightBill, getAllLightBills } = require("../controllers/lightBillController");
// const User = require('../models/userModel');
// // const jwt = require('jsonwebtoken');
// const bcrypt = require('bcryptjs');
// const LightBillEntry = require("../models/LightBillEntry");
// router.post("/", createLightBill);
// router.get("/all", getAllLightBills);


// // Update Light Bill
// router.put('/:id', async (req, res) => {
//   try {
//     const lightBill = await LightBillEntry.findByIdAndUpdate(req.params.id, req.body, { new: true });
//     if (!lightBill) return res.status(404).json({ message: 'Light Bill not found' });
//     res.json(lightBill);
//   } catch (err) {
//     res.status(400).json({ message: err.message });
//   }
// });

// // Delete Light Bill
// router.delete('/:id', async (req, res) => {
//   try {
//     const lightBill = await LightBillEntry.findByIdAndDelete(req.params.id);
//     if (!lightBill) return res.status(404).json({ message: 'Light Bill not found' });
//     res.json({ message: 'Light Bill deleted successfully' });
//   } catch (err) {
//     res.status(400).json({ message: err.message });
//   }
// });




// // Example Express route in your backend
// router.get('/all-bills', async (req, res) => {
//   try {
//     const { month, year } = req.query;

//     const query = {};
//     if (month && year) {
//       const startDate = new Date(year, month - 1, 1); // month is 0-indexed
//       const endDate = new Date(year, month, 0, 23, 59, 59, 999);
//       query.date = { $gte: startDate, $lte: endDate };
//     }

//     const bills = await LightBillEntry.find(query).sort({ date: -1 });
//     res.json(bills);
//   } catch (error) {
//     console.error(error);
//     res.status(500).send("Server Error");
//   }
// });

// module.exports = router;






const express = require("express");
const router = express.Router();
const {
  createLightBill,
  getAllLightBills
} = require("../controllers/lightBillController");
const LightBillEntry = require("../models/LightBillEntry");
const Room = require("../models/Room");
const Organization = require("../models/Organization");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery, scopedUpdate } = require("../utils/organizationScope");
const { actorName, diffRecords, writeAuditLog } = require("../utils/auditLogger");
const { getLightBillCollectionSummary } = require("./_helpers/lightBillBilling");

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

const PROPERTY_TYPES = ["bed", "room", "shop"];
const ROOM_SHOP_MODES = new Set([
  "none",
  "owner_only",
  "tenant_unit_manual",
  "tenant_unit_meter",
  "tenant_direct",
  "fixed_monthly",
]);
const BED_MODES = new Set([
  "none",
  "owner_only",
  "room_meter_split",
  "room_meter_rate",
  "room_meter_actual_bill",
  "fixed_per_tenant",
  "common_owner_bill",
  "included_extra_split",
  "common_meter_split",
  "record_only",
]);
const SPLIT_METHODS = new Set(["equal_active_tenants", "manual", "by_room", "by_bed"]);

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizePropertySettings(type, input = {}) {
  const allowedModes = type === "bed" ? BED_MODES : ROOM_SHOP_MODES;
  const requestedMode = String(input.mode || "");
  const legacyMode = requestedMode === "room_meter_split" || requestedMode === "included_extra_split"
    ? "room_meter_rate"
    : requestedMode;
  const mode = allowedModes.has(legacyMode) ? legacyMode : "none";
  const enabled = Boolean(input.enabled) && mode !== "none";
  const splitMethod = SPLIT_METHODS.has(String(input.splitMethod || ""))
    ? String(input.splitMethod)
    : "equal_active_tenants";

  return {
    enabled,
    mode: enabled ? mode : "none",
    addToRentCollection: Boolean(input.addToRentCollection) && !["none", "owner_only", "record_only", "tenant_direct", "common_owner_bill"].includes(mode),
    fixedAmount: toNumber(input.fixedAmount),
    includedAmount: toNumber(input.includedAmount),
    includedUnits: toNumber(input.includedUnits),
    ratePerUnit: toNumber(input.ratePerUnit),
    fixedCharge: 0,
    splitMethod,
    notes: normalizeText(input.notes).slice(0, 250),
  };
}

function publicLightBillSettings(organization) {
  const settings = organization?.lightBillSettings || {};
  return {
    isConfigured: Boolean(settings.isConfigured),
    bed: normalizePropertySettings("bed", settings.bed || {}),
    room: normalizePropertySettings("room", settings.room || {}),
    shop: normalizePropertySettings("shop", settings.shop || {}),
    updatedAt: settings.updatedAt || null,
  };
}

function normalizeLightBillSettings(input = {}) {
  const settings = {
    bed: normalizePropertySettings("bed", input.bed || {}),
    room: normalizePropertySettings("room", input.room || {}),
    shop: normalizePropertySettings("shop", input.shop || {}),
  };
  settings.isConfigured = PROPERTY_TYPES.some((type) => settings[type].enabled);
  settings.updatedAt = new Date();
  return settings;
}

// Routes
router.get("/settings", async (req, res) => {
  try {
    const organization = req.organization || await Organization.findById(req.organizationId);
    if (!organization) return res.status(404).json({ message: "Organization not found" });
    res.json(publicLightBillSettings(organization));
  } catch (err) {
    res.status(500).json({ message: "Unable to load light bill settings", error: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    if (!req.organizationId) return res.status(403).json({ message: "Organization required" });
    const settings = normalizeLightBillSettings(req.body || {});
    const organization = await Organization.findByIdAndUpdate(
      req.organizationId,
      { $set: { lightBillSettings: settings } },
      { new: true }
    );
    if (!organization) return res.status(404).json({ message: "Organization not found" });
    res.json({ message: "Light bill settings saved", settings: publicLightBillSettings(organization) });
  } catch (err) {
    res.status(500).json({ message: "Unable to save light bill settings", error: err.message });
  }
});

router.post("/", createLightBill);
router.get("/all", getAllLightBills);

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value) {
  return normalizeText(value).toUpperCase();
}

function monthRange(value) {
  const entryDate = new Date(value);
  return {
    start: new Date(entryDate.getFullYear(), entryDate.getMonth(), 1),
    end: new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 1),
  };
}

function billingMonthFromDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()] + `-${String(date.getFullYear()).slice(-2)}`;
}

async function syncMeterState(req, bill) {
  if (!bill || bill.type !== "meter" || bill.billPayer === "owner" || bill.isUnitLinked === false) return;

  const reading = bill.totalReading === undefined || bill.totalReading === "" ? null : Number(bill.totalReading);
  const roomUpdate = {};
  if (bill.meterNo !== undefined) roomUpdate.meterNo = normalizeIdentifier(bill.meterNo);
  if (Number.isFinite(reading) && reading >= 0) roomUpdate.lastMeterReading = reading;
  if (!Object.keys(roomUpdate).length) return;

  const roomFilter = bill.roomId
    ? { _id: bill.roomId }
    : { propertyType: bill.propertyType || "bed", roomNo: normalizeIdentifier(bill.roomNo) };
  if (roomUpdate.meterNo) {
    const currentRoom = await Room.findOne(scopedQuery(req, roomFilter));
    const duplicateMeter = await Room.findOne(scopedQuery(req, {
      meterNo: roomUpdate.meterNo,
      ...(currentRoom?._id ? { _id: { $ne: currentRoom._id } } : {}),
    })).collation({ locale: "en", strength: 2 });
    if (duplicateMeter) {
      const error = new Error("Meter number already exists for another unit");
      error.status = 400;
      throw error;
    }
  }

  await Room.findOneAndUpdate(scopedQuery(req, roomFilter), { $set: scopedUpdate(req, roomUpdate) });
}

// Update
router.put('/:id', async (req, res) => {
  try {
    const updatePayload = { ...req.body };
    if (updatePayload.roomNo !== undefined) updatePayload.roomNo = normalizeIdentifier(updatePayload.roomNo);
    if (updatePayload.meterNo !== undefined) updatePayload.meterNo = normalizeIdentifier(updatePayload.meterNo);

    const current = await LightBillEntry.findOne(scopedQuery(req, { _id: req.params.id }));
    if (!current) return res.status(404).json({ message: 'Light Bill not found' });
    const before = current.toObject();

    const nextType = updatePayload.type || current.type;
    const nextBillPayer = updatePayload.billPayer || current.billPayer || "tenant";
    const nextBillingMode = updatePayload.billingMode || current.billingMode || (nextBillPayer === "owner" ? "owner_only" : "tenant_unit_manual");
    const nextIsUnitLinked = updatePayload.isUnitLinked !== false;
    if (nextBillPayer === "owner" && !nextIsUnitLinked) {
      updatePayload.isUnitLinked = false;
      updatePayload.roomId = null;
      updatePayload.roomNo = "";
    } else if (updatePayload.isUnitLinked === undefined) {
      updatePayload.isUnitLinked = true;
    }

    if ((nextType || "meter") === "meter" && nextIsUnitLinked) {
      const nextBillingMonth = updatePayload.billingMonth || current.billingMonth || billingMonthFromDate(updatePayload.date || current.date);
      const nextRoomId = updatePayload.roomId ?? current.roomId;
      const nextPropertyType = updatePayload.propertyType || current.propertyType || "bed";
      const nextRoomNo = updatePayload.roomNo ?? current.roomNo ?? "";
      const duplicateFilter = scopedQuery(req, {
        _id: { $ne: req.params.id },
        propertyType: nextPropertyType,
        isUnitLinked: true,
        billingMonth: nextBillingMonth,
      });
      const normalizedNextRoomNo = normalizeIdentifier(nextRoomNo);
      if (nextRoomId) duplicateFilter.roomId = nextRoomId;
      else duplicateFilter.roomNo = normalizedNextRoomNo;

      const duplicate = await LightBillEntry.findOne(duplicateFilter);
      if (duplicate) {
        return res.status(409).json({ message: "Light bill already exists for this unit and month" });
      }
    }

    if (!nextIsUnitLinked && ["common_owner_bill", "common_meter_split"].includes(nextBillingMode)) {
      const nextBillingMonth = updatePayload.billingMonth || current.billingMonth || billingMonthFromDate(updatePayload.date || current.date);
      const duplicate = await LightBillEntry.findOne(scopedQuery(req, {
        _id: { $ne: req.params.id },
        propertyType: "bed",
        billingMode: nextBillingMode,
        billingMonth: nextBillingMonth,
      }));
      if (duplicate) {
        return res.status(409).json({ message: "Common hostel light bill already exists for this month" });
      }
    }

    const lightBill = await LightBillEntry.findOneAndUpdate(
      scopedQuery(req, { _id: req.params.id }),
      scopedUpdate(req, { ...updatePayload, updatedByName: actorName(req) }),
      { new: true }
    );
    if (!lightBill) return res.status(404).json({ message: 'Light Bill not found' });
    await syncMeterState(req, lightBill);
    await writeAuditLog(req, {
      entityType: "lightBill",
      entityId: lightBill._id,
      action: "update",
      before,
      after: lightBill,
      changes: diffRecords(before, lightBill, ["name", "billPayer", "billingMode", "isUnitLinked", "propertyType", "roomNo", "meterNo", "totalReading", "amount", "salary", "status", "billingMonth", "date"]),
    });
    res.json(lightBill);
  } catch (err) {
    res.status(err.status || 400).json({ message: err.message });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    const lightBill = await LightBillEntry.findOneAndDelete(scopedQuery(req, { _id: req.params.id }));
    if (!lightBill) return res.status(404).json({ message: 'Light Bill not found' });
    await writeAuditLog(req, {
      entityType: "lightBill",
      entityId: lightBill._id,
      action: "delete",
      before: lightBill,
      reason: req.body?.reason || "",
    });
    res.json({ message: 'Light Bill deleted successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Get by month & year (optional)
router.get('/all-bills', async (req, res) => {
  try {
    const { month, year } = req.query;
    const query = scopedQuery(req);
    if (month && year) {
      const startDate = new Date(year, month - 1, 1);
      const endDate = new Date(year, month, 0, 23, 59, 59, 999);
      const billingMonth = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(month) - 1] + `-${String(year).slice(-2)}`;
      query.$or = [
        { billingMonth },
        { billingMonth: { $exists: false }, date: { $gte: startDate, $lte: endDate } },
      ];
    }

    const bills = await LightBillEntry.find(query).sort({ date: -1 }).lean();
    const roomIds = bills.map((bill) => bill.roomId).filter(Boolean);
    const legacyUnitQueries = bills
      .filter((bill) => !bill.roomId && bill.isUnitLinked !== false && bill.roomNo)
      .map((bill) => ({ propertyType: bill.propertyType || "bed", roomNo: bill.roomNo }));
    const rooms = (roomIds.length || legacyUnitQueries.length)
      ? await Room.find(scopedQuery(req, {
          $or: [
            ...(roomIds.length ? [{ _id: { $in: roomIds } }] : []),
            ...legacyUnitQueries,
          ],
        })).select("propertyType category wingName floorNo roomNo").lean()
      : [];
    const roomsById = new Map(rooms.map((room) => [String(room._id), room]));
    const enrichedBills = await Promise.all(bills.map(async (bill) => {
      const room = bill.roomId
        ? roomsById.get(String(bill.roomId))
        : rooms.find((item) =>
            String(item.propertyType || "bed") === String(bill.propertyType || "bed") &&
            String(item.roomNo || "") === String(bill.roomNo || "") &&
            (!bill.category || String(item.category || "") === String(bill.category))
          );
      return {
        ...bill,
        category: bill.category || room?.category || "",
        wingName: bill.wingName || room?.wingName || "",
        floorNo: bill.floorNo || room?.floorNo || "",
        tenantCollection: await getLightBillCollectionSummary(req, bill),
      };
    }));
    res.json(enrichedBills);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

module.exports = router;
