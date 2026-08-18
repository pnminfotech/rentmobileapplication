
// const LightBillEntry = require("../models/LightBillEntry");

// exports.createLightBill = async (req, res) => {
//   try {
//     const { roomNo, meterNo, totalReading, amount,status, date } = req.body;

//     const bill = new LightBillEntry({ roomNo, meterNo, totalReading, amount,status, date });
//     await bill.save();

//     res.status(201).json({ message: "Light bill saved successfully." });
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Failed to save light bill." });
//   }
// };

// exports.getAllLightBills = async (req, res) => {
//   try {
//     const bills = await LightBillEntry.find().sort({ date: -1 });
//     res.json(bills);
//   } catch (error) {
//     console.error(error);
//     res.status(500).json({ message: "Failed to fetch light bills." });
//   }
// };






// const LightBillEntry = require("../models/LightBillEntry");

const LightBillEntry = require("../models/LightBillEntry");
const Room = require("../models/Room");
const { scopedQuery, scopedCreate, scopedUpdate } = require("../utils/organizationScope");
const { actorName, writeAuditLog } = require("../utils/auditLogger");

const BILLING_MODES = new Set([
  "owner_only",
  "tenant_unit_manual",
  "tenant_unit_meter",
  "fixed_monthly",
  "room_meter_split",
  "included_extra_split",
  "fixed_per_tenant",
  "common_meter_split",
]);

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

exports.createLightBill = async (req, res) => {
  try {
    const {
      name,
      type,
      billPayer,
      billingMode,
      isUnitLinked,
      roomId,
      propertyType,
      roomNo,
      meterNo,
      previousReading,
      totalReading,
      consumedUnits,
      ratePerUnit,
      fixedCharge,
      amount,
      salary,
      customLabel,
      status,
      date
    } = req.body;
    const normalizedType = ["meter", "maushi", "custom"].includes(type) ? type : "meter";
    const normalizedBillPayer = billPayer === "owner" ? "owner" : "tenant";
    const requestedBillingMode = normalizeText(billingMode) || (normalizedBillPayer === "owner" ? "owner_only" : "tenant_unit_manual");
    const normalizedBillingMode = BILLING_MODES.has(requestedBillingMode) ? requestedBillingMode : (normalizedBillPayer === "owner" ? "owner_only" : "tenant_unit_manual");
    const linkedToUnit = normalizedBillPayer === "tenant" && isUnitLinked !== false;
    const normalizedRoomNo = linkedToUnit ? normalizeIdentifier(roomNo) : "";
    const normalizedMeterNo = normalizeIdentifier(meterNo);
    const normalizedPropertyType = propertyType || "bed";
    const numericAmount = Number(amount ?? salary ?? 0);
    const numericPreviousReading = previousReading === undefined || previousReading === "" ? null : Number(previousReading);
    const numericTotalReading = totalReading === undefined || totalReading === "" ? null : Number(totalReading);
    const numericConsumedUnits = consumedUnits === undefined || consumedUnits === "" ? null : Number(consumedUnits);
    const numericRatePerUnit = ratePerUnit === undefined || ratePerUnit === "" ? null : Number(ratePerUnit);
    const numericFixedCharge = fixedCharge === undefined || fixedCharge === "" ? null : Number(fixedCharge);
    const billDate = new Date(date);

    if (!name || !normalizeText(name)) {
      return res.status(400).json({ message: "Bill name is required" });
    }
    if (!["bed", "room", "shop"].includes(normalizedPropertyType)) {
      return res.status(400).json({ message: "Valid property type is required" });
    }
    if (Number.isNaN(billDate.getTime())) {
      return res.status(400).json({ message: "Valid bill date is required" });
    }
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Bill amount must be greater than zero" });
    }
    if (numericPreviousReading !== null && (!Number.isFinite(numericPreviousReading) || numericPreviousReading < 0)) {
      return res.status(400).json({ message: "Previous reading must be zero or greater" });
    }
    if (numericTotalReading !== null && (!Number.isFinite(numericTotalReading) || numericTotalReading < 0)) {
      return res.status(400).json({ message: "Current reading must be zero or greater" });
    }
    if (
      numericPreviousReading !== null &&
      numericTotalReading !== null &&
      numericTotalReading < numericPreviousReading
    ) {
      return res.status(400).json({ message: "Current reading cannot be less than previous reading" });
    }
    if (numericConsumedUnits !== null && (!Number.isFinite(numericConsumedUnits) || numericConsumedUnits < 0)) {
      return res.status(400).json({ message: "Consumed units must be zero or greater" });
    }
    if (linkedToUnit && !normalizedRoomNo && !roomId) {
      return res.status(400).json({ message: "Select a room/unit for tenant light bill" });
    }

    if (linkedToUnit) {
      const { start: startOfMonth, end: endOfMonth } = monthRange(date);
      const filter = scopedQuery(req, {
        isUnitLinked: true,
        propertyType: normalizedPropertyType,
        date: { $gte: startOfMonth, $lt: endOfMonth }
      });
      if (roomId) filter.$or = [{ roomId }, { roomNo: normalizedRoomNo }];
      else filter.roomNo = normalizedRoomNo;

      const existing = await LightBillEntry.findOne(filter);
      if (existing) {
        return res.status(409).json({ message: "Light bill already exists for this unit and month" });
      }
    }

    if (!linkedToUnit && normalizedBillingMode === "common_meter_split") {
      const { start: startOfMonth, end: endOfMonth } = monthRange(date);
      const existing = await LightBillEntry.findOne(scopedQuery(req, {
        propertyType: "bed",
        billingMode: "common_meter_split",
        date: { $gte: startOfMonth, $lt: endOfMonth },
      }));
      if (existing) {
        return res.status(409).json({ message: "Common hostel light bill already exists for this month" });
      }
    }

    if (normalizedType === "meter" && linkedToUnit && normalizedMeterNo) {
      const roomFilter = roomId
        ? { _id: roomId }
        : { propertyType: normalizedPropertyType, roomNo: normalizedRoomNo };
      const currentRoom = await Room.findOne(scopedQuery(req, roomFilter));
      const duplicateMeter = await Room.findOne(scopedQuery(req, {
        meterNo: normalizedMeterNo,
        ...(currentRoom?._id ? { _id: { $ne: currentRoom._id } } : {}),
      })).collation({ locale: "en", strength: 2 });
      if (duplicateMeter) {
        return res.status(400).json({ message: "Meter number already exists for another unit" });
      }
    }

    const update = scopedCreate(req, {
      name,
      type: normalizedType,
      billPayer: normalizedBillPayer,
      billingMode: normalizedBillingMode,
      isUnitLinked: linkedToUnit,
      roomId: linkedToUnit && roomId ? roomId : null,
      propertyType: normalizedPropertyType,
      roomNo: normalizedRoomNo,
      meterNo: normalizedMeterNo,
      previousReading: numericPreviousReading,
      totalReading: numericTotalReading,
      consumedUnits: numericConsumedUnits,
      ratePerUnit: numericRatePerUnit,
      fixedCharge: numericFixedCharge,
      amount: numericAmount,
      salary,
      customLabel,
      status,
      date: billDate,
      createdByName: actorName(req),
      updatedByName: actorName(req),
    });

    const result = await LightBillEntry.create(update);

    if (normalizedType === "meter" && linkedToUnit) {
      const reading = numericTotalReading;
      const roomUpdate = {};
      if (meterNo !== undefined) roomUpdate.meterNo = normalizedMeterNo;
      if (Number.isFinite(reading) && reading >= 0) roomUpdate.lastMeterReading = reading;

      if (Object.keys(roomUpdate).length) {
        const roomFilter = roomId
          ? { _id: roomId }
          : { propertyType: normalizedPropertyType, roomNo: normalizedRoomNo };
        await Room.findOneAndUpdate(scopedQuery(req, roomFilter), { $set: scopedUpdate(req, roomUpdate) });
      }
    }

    await writeAuditLog(req, {
      entityType: "lightBill",
      entityId: result._id,
      action: "create",
      after: result,
    });

    res.status(201).json({
      message: "Light bill entry saved successfully.",
      entry: result
    });

  } catch (error) {
    console.error(error);
    res.status(error.status || 500).json({ message: error.message || "Failed to save light bill entry." });
  }
};

exports.getAllLightBills = async (req, res) => {
  try {
    const bills = await LightBillEntry.find(scopedQuery(req)).sort({ date: -1 });
    res.json(bills);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch light bill entries." });
  }
};
