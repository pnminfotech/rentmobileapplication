// routes/formRoutes.js
const express = require("express");
const router = express.Router();
const XLSX = require("xlsx");

// Models (used by a couple of inline routes)
const Form = require("../models/formModels");
const Organization = require("../models/Organization");
const Room = require("../models/Room");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery, scopedCreate } = require("../utils/organizationScope");
const { diffRecords, writeAuditLog } = require("../utils/auditLogger");
const { resolveNotifications } = require("../services/notificationService");
const { sendAdmissionSms } = require("../services/smsService");
const {
  appendRentHistorySnapshot,
  getRentCycleForDate,
  getRentProrationForMonth,
  getExpectedRentForMonth,
  getPaidAmountForMonth,
  getPaymentsBetweenDates,
  getRentCyclesBetweenDates,
  parseMonthKey,
  getUnpaidRentBeforeDate,
} = require("./_helpers/rentHistory");
const { getCanteenQuoteForMonth } = require("./_helpers/canteenBilling");
const { getLightBillQuoteForMonth } = require("./_helpers/lightBillBilling");
const { sendRentReminderSmsJob } = require("../services/rentReminderSmsService");

// Controllers
const {
  getNextSrNo,
  rentAmountDel,
  processLeave,
  getFormById,
  getForms,
  updateFormById,
  updateProfile,
  getArchivedForms,
  saveLeaveDate,
  restoreForm,
  archiveForm,
  getDuplicateForms,
  deleteForm,
  updateForm,
  saveForm, // kept/exported for legacy use (NOT bound to POST /forms)
  getAllForms,
  assignNextSrNoAndUpdateCounter,
} = require("../controllers/formController");

const {
  createWithOptionalInvite,
} = require("../controllers/forms/createWithOptionalInvite");

// NEW: invite controller routes
const { createInvite, createInviteForForm, validateInvite } = require("../controllers/invites");
const { submitInviteForm } = require("./invites");

router.use(attachSystemAuthIfPresent);
router.get("/invites/:token", validateInvite);
router.put("/invites/:token/submit", submitInviteForm);
router.use(authAdmin);

// ───────────────────────────────────────────────────────────────────────────────
// CREATE: must be the ONLY creator for /forms
// NOTE: Inside createWithOptionalInvite, you should also use
//       assignNextSrNoAndUpdateCounter() from formController
//       instead of trusting srNo from frontend.
// ───────────────────────────────────────────────────────────────────────────────
router.post("/forms", createWithOptionalInvite);

// For UI to show next SrNo (server still assigns the real one)
router.get("/forms/count", getNextSrNo);
router.post("/forms/import", async (req, res) => {
  try {
    const propertyType = normalizeTenantImportPropertyType(req.body?.propertyType);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ message: "Add at least one tenant row to import." });
    }
    if (rows.length > 2000) {
      return res.status(400).json({ message: "You can import up to 2000 tenants at a time." });
    }

    const detectedSheetType = detectTenantImportSheetType(rows);
    if (detectedSheetType && detectedSheetType !== propertyType) {
      return res.status(400).json({
        message: `This looks like a ${tenantImportTypeLabel(detectedSheetType)} sheet, but you are importing in ${tenantImportTypeLabel(propertyType)}.`,
        error: `Please open the ${tenantImportTypeLabel(propertyType)} tab and upload the matching template only.`,
      });
    }

    const [rooms, existingForms] = await Promise.all([
      Room.find(scopedQuery(req, { propertyType })).lean(),
      Form.find(scopedQuery(req)).lean(),
    ]);

    const units = rooms.map((room) => {
      const beds = Array.isArray(room.beds) ? room.beds : [];
      const primaryBed = beds[0] || {};
      return {
        room,
        category: normalizeImportToken(room.category),
        wingName: normalizeImportToken(room.wingName),
        floorNo: normalizeImportToken(room.floorNo),
        roomNo: normalizeImportToken(room.roomNo),
        propertyType: normalizeTenantImportPropertyType(room.propertyType),
        primaryBedNo: normalizeImportToken(
          propertyType === "room" ? "ROOM-1" : propertyType === "shop" ? "SHOP-1" : primaryBed.bedNo
        ),
        beds: beds.map((bed) => ({
          ...bed,
          bedNo: normalizeImportToken(bed.bedNo),
          price: Number(bed.price || 0),
        })),
      };
    });

    const activeForms = existingForms.filter(isImportTenantActive);

    const occupiedSlots = new Set();
    activeForms.forEach((tenant) => {
      const key = slotKeyForImportTenant(tenant);
      if (key) occupiedSlots.add(key);
    });

    const created = [];
    const duplicates = [];
    const invalidRows = [];

    for (let index = 0; index < rows.length; index += 1) {
      const rowNumber = index + 2;
      const row = rows[index];
      const normalized = normalizeTenantImportRow(row, propertyType);

      if (normalized.error) {
        invalidRows.push({ rowNumber, name: normalized.name || "", reason: normalized.error });
        continue;
      }

      const phoneKey = normalizeImportPhone(normalized.phoneNo);

      const matchedUnit = findMatchingImportUnit(units, normalized, propertyType);
      if (!matchedUnit) {
        invalidRows.push({
          rowNumber,
          name: normalized.name,
          reason: propertyType === "bed"
            ? "Matching hostel room/bed was not found."
            : propertyType === "room"
            ? "Matching residential room was not found."
            : "Matching commercial shop was not found.",
        });
        continue;
      }

      const resolvedBedNo = propertyType === "bed"
        ? normalizeImportToken(normalized.bedNo)
        : matchedUnit.primaryBedNo;
      if (propertyType === "bed" && !resolvedBedNo) {
        invalidRows.push({ rowNumber, name: normalized.name, reason: "Bed number is required for hostel imports." });
        continue;
      }
      if (propertyType === "bed" && !matchedUnit.beds.some((bed) => bed.bedNo === resolvedBedNo)) {
        invalidRows.push({ rowNumber, name: normalized.name, reason: `Bed ${normalized.bedNo || "-"} does not exist in room ${normalized.roomNo || "-"}.` });
        continue;
      }

      const slotKey = buildImportSlotKey({
        propertyType,
        category: matchedUnit.room.category,
        wingName: matchedUnit.room.wingName,
        floorNo: matchedUnit.room.floorNo,
        roomNo: matchedUnit.room.roomNo,
        bedNo: resolvedBedNo,
      });

      if (slotKey && occupiedSlots.has(slotKey)) {
        duplicates.push({
          rowNumber,
          name: normalized.name,
          phoneNo: normalized.phoneNo,
          reason: propertyType === "bed"
            ? `Room ${matchedUnit.room.roomNo}, bed ${resolvedBedNo} is already occupied.`
            : propertyType === "room"
            ? `Residential room ${matchedUnit.room.roomNo} is already occupied.`
            : `Shop ${matchedUnit.room.roomNo} is already occupied.`,
        });
        continue;
      }

      const selectedBed = propertyType === "bed"
        ? matchedUnit.beds.find((bed) => bed.bedNo === resolvedBedNo)
        : matchedUnit.beds[0] || { price: 0 };
      const baseRent = Number.isFinite(Number(normalized.baseRent)) && Number(normalized.baseRent) > 0
        ? Number(normalized.baseRent)
        : Number(selectedBed?.price || 0);
      const joiningDate = parseImportDateValue(normalized.joiningDate);

      if (!joiningDate) {
        invalidRows.push({ rowNumber, name: normalized.name, reason: "Joining date must be a valid date." });
        continue;
      }

      const payload = scopedCreate(req, {
        name: normalized.name,
        joiningDate,
        propertyType,
        category: matchedUnit.room.category || "",
        hasWing: Boolean(matchedUnit.room.hasWing && matchedUnit.room.wingName),
        wingName: matchedUnit.room.wingName || "",
        roomId: String(matchedUnit.room._id),
        roomNo: matchedUnit.room.roomNo || "",
        floorNo: matchedUnit.room.floorNo || "",
        bedNo: resolvedBedNo,
        depositAmount: Number(normalized.depositAmount || 0),
        address: normalized.address,
        pincode: normalized.pincode,
        city: normalized.city,
        state: normalized.state,
        houseNo: normalized.houseNo,
        nearbyPlace: normalized.nearbyPlace,
        relativeAddress1: normalized.relativeAddress1,
        phoneNo: Number(phoneKey),
        relative1Relation: normalized.relative1Relation || "Self",
        relative1Name: normalized.relative1Name,
        relative1Phone: normalized.relative1Phone,
        relative2Relation: normalized.relative2Relation || "Father",
        relative2Name: normalized.relative2Name,
        relative2Phone: normalized.relative2Phone,
        familyMembers: propertyType === "room" ? Number(normalized.familyMembers || 0) : 0,
        hasCanteen: propertyType === "bed" ? parseImportBoolean(normalized.hasCanteen) : false,
        shopName: propertyType === "shop" ? normalized.shopName : "",
        shopBusiness: propertyType === "shop" ? normalized.shopBusiness : "",
        companyAddress: propertyType === "shop" ? normalized.companyAddress : "",
        baseRent,
        firstRentStatus: normalized.firstRentStatus,
        intakeStatus: "submitted",
        rents: [],
        rentHistory: baseRent > 0 ? [{
          effectiveFrom: joiningDate,
          roomNo: matchedUnit.room.roomNo || "",
          bedNo: resolvedBedNo,
          baseRent,
          rentAmount: baseRent,
          source: "import",
        }] : [],
      });

      const nextSrNo = await assignNextSrNoAndUpdateCounter();
      payload.srNo = Number(nextSrNo);

      const doc = await Form.create(payload);
      const organization = doc.organizationId
        ? await Organization.findById(doc.organizationId).lean()
        : null;
      sendAdmissionSms(doc, organization || {}).catch((err) =>
        console.error("Import admission SMS failed:", err.message)
      );
      created.push({
        _id: doc._id,
        srNo: doc.srNo,
        name: doc.name,
        roomNo: doc.roomNo,
        bedNo: doc.bedNo,
      });
      if (slotKey) occupiedSlots.add(slotKey);
    }

    return res.status(200).json({
      propertyType,
      createdCount: created.length,
      duplicateCount: duplicates.length,
      invalidCount: invalidRows.length,
      skippedCount: duplicates.length + invalidRows.length,
      created,
      duplicates,
      invalidRows,
    });
  } catch (error) {
    console.error("Tenant import failed:", error);
    return res.status(500).json({ message: "Unable to import tenants", error: error.message });
  }
});

router.get("/forms/rent-dues", async (req, res) => {
  try {
    const [tenants, rooms] = await Promise.all([
      Form.find(scopedQuery(req)).lean(),
      Room.find(scopedQuery(req)).lean(),
    ]);
    const asOf = new Date();
    const dueTenants = tenants
      .filter((tenant) => tenant.intakeStatus !== "pending_tenant")
      .map((tenant) => {
        const dueMonths = getUnpaidRentBeforeDate(tenant, asOf, rooms);
        const totalDue = dueMonths.reduce(
          (sum, month) => sum + Number(month.outstanding || 0),
          0
        );
        return {
          tenantId: tenant._id,
          name: tenant.name || "",
          phoneNo: tenant.phoneNo || "",
          roomNo: tenant.roomNo || "",
          bedNo: tenant.bedNo || "",
          totalDue,
          dueMonths,
        };
      })
      .filter((tenant) => tenant.totalDue > 0)
      .sort((a, b) => b.totalDue - a.totalDue);

    res.json({
      asOf,
      totalDue: dueTenants.reduce((sum, tenant) => sum + tenant.totalDue, 0),
      tenantCount: dueTenants.length,
      tenants: dueTenants,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate rent dues", error: error.message });
  }
});

router.post("/forms/rent-reminders/sms/run", async (req, res) => {
  try {
    const result = await sendRentReminderSmsJob({
      organizationId: req.organizationId,
      now: req.body?.now,
      dueDate: req.body?.dueDate,
    });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, message: "Unable to send rent reminder SMS", error: error.message });
  }
});

router.get("/forms/rent-summary", async (req, res) => {
  try {
    const parsed = parseMonthKey(String(req.query.month || ""));
    if (!parsed) return res.status(400).json({ message: "Valid month is required" });
    const [tenants, rooms] = await Promise.all([Form.find(scopedQuery(req)).lean(), Room.find(scopedQuery(req)).lean()]);
    const rows = await Promise.all(tenants.filter((tenant) => tenant.intakeStatus !== "pending_tenant").map(async (tenant) => {
      const expected = getExpectedRentForMonth(tenant, parsed.y, parsed.m, rooms);
      const paid = getPaidAmountForMonth(tenant.rents, parsed.y, parsed.m);
      const canteen = await getCanteenQuoteForMonth(req, tenant, req.query.month);
      const lightBill = await getLightBillQuoteForMonth(req, tenant, req.query.month);
      const rentEntry = (tenant.rents || []).find((entry) => entry.month === req.query.month);
      const canteenPaid = Number(rentEntry?.canteenAmount || 0);
      const lightBillPaid = Number(rentEntry?.lightBillAmount || 0);
      return {
        tenantId: tenant._id,
        expected,
        paid,
        balance: Math.max(expected - paid, 0),
        canteenExpected: Number(canteen.expected || 0),
        canteenPaid,
        canteenBalance: Math.max(Number(canteen.expected || 0) - canteenPaid, 0),
        canteenMode: canteen.mode || "",
        canteenMealCounts: canteen.mealCounts || {},
        canteenPresentDays: canteen.presentDays || 0,
        canteenDaysInMonth: canteen.daysInMonth || 0,
        canteenMonthlyAmount: canteen.monthlyAmount || 0,
        canteenBreakdown: canteen.breakdown || [],
        lightBillExpected: Number(lightBill.expected || 0),
        lightBillPaid,
        lightBillBalance: Math.max(Number(lightBill.expected || 0) - lightBillPaid, 0),
        lightBillMode: lightBill.mode || "",
        lightBillModeLabel: lightBill.modeLabel || "",
        lightBillBreakdown: lightBill.breakdown || [],
        totalExpected: expected + Number(canteen.expected || 0) + Number(lightBill.expected || 0),
        totalPaid: paid + canteenPaid + lightBillPaid,
        totalBalance: Math.max(expected - paid, 0) + Math.max(Number(canteen.expected || 0) - canteenPaid, 0) + Math.max(Number(lightBill.expected || 0) - lightBillPaid, 0),
      };
    }));
    res.json({ month: req.query.month, rows });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate rent summary", error: error.message });
  }
});

router.get("/forms/rent-range-summary", async (req, res) => {
  try {
    const start = new Date(req.query.start);
    const end = new Date(req.query.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return res.status(400).json({ message: "Valid start and end dates are required" });
    const [tenants, rooms] = await Promise.all([Form.find(scopedQuery(req)).lean(), Room.find(scopedQuery(req)).lean()]);
    const rows = tenants.filter((tenant) => tenant.intakeStatus !== "pending_tenant").map((tenant) => {
      const cycles = getRentCyclesBetweenDates(tenant, start, end, rooms);
      const transactions = getPaymentsBetweenDates(tenant, start, end);
      return {
        tenantId: tenant._id,
        expected: cycles.reduce((sum, cycle) => sum + cycle.expected, 0),
        paidForCycles: cycles.reduce((sum, cycle) => sum + cycle.paid, 0),
        pending: cycles.reduce((sum, cycle) => sum + cycle.pending, 0),
        collected: transactions.reduce((sum, transaction) => sum + transaction.amount, 0),
        cycles,
        transactions,
      };
    });
    res.json({ start, end, rows });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate custom report", error: error.message });
  }
});

router.get("/form/:id/rent-due", async (req, res) => {
  try {
    const [tenant, rooms] = await Promise.all([
      Form.findOne(scopedQuery(req, { _id: req.params.id })).lean(),
      Room.find(scopedQuery(req)).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const dueMonths = getUnpaidRentBeforeDate(tenant, new Date(), rooms);
    res.json({
      tenantId: tenant._id,
      totalDue: dueMonths.reduce((sum, month) => sum + Number(month.outstanding || 0), 0),
      dueMonths,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate tenant rent due", error: error.message });
  }
});

router.get("/form/:id/rent-quote", async (req, res) => {
  try {
    const parsed = parseMonthKey(String(req.query.month || ""));
    if (!parsed) return res.status(400).json({ message: "Valid month is required" });
    const [tenant, rooms] = await Promise.all([
      Form.findOne(scopedQuery(req, { _id: req.params.id })).lean(),
      Room.find(scopedQuery(req)).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    const breakdown = getRentProrationForMonth(tenant, parsed.y, parsed.m, rooms);
    const paid = getPaidAmountForMonth(tenant.rents, parsed.y, parsed.m);
    const canteen = await getCanteenQuoteForMonth(req, tenant, req.query.month);
    const lightBill = await getLightBillQuoteForMonth(req, tenant, req.query.month);
    const existingEntry = (tenant.rents || []).find((rent) => rent.month === req.query.month);
    const canteenPaid = Number(existingEntry?.canteenAmount || 0);
    const lightBillPaid = Number(existingEntry?.lightBillAmount || 0);
    const rentBalance = Math.max(breakdown.expected - paid, 0);
    const canteenBalance = Math.max(Number(canteen.expected || 0) - canteenPaid, 0);
    const lightBillBalance = Math.max(Number(lightBill.expected || 0) - lightBillPaid, 0);
    res.json({
      month: req.query.month,
      ...breakdown,
      paid,
      balance: rentBalance,
      canteen: {
        ...canteen,
        paid: canteenPaid,
        balance: canteenBalance,
      },
      lightBill: {
        ...lightBill,
        paid: lightBillPaid,
        balance: lightBillBalance,
      },
      totalExpected: Number(breakdown.expected || 0) + Number(canteen.expected || 0) + Number(lightBill.expected || 0),
      totalPaid: paid + canteenPaid + lightBillPaid,
      totalBalance: rentBalance + canteenBalance + lightBillBalance,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate rent quote", error: error.message });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// INVITES (create + validate)
// ───────────────────────────────────────────────────────────────────────────────
router.post("/invites", createInvite);
router.post("/invites/for-form/:id", createInviteForForm);

// ───────────────────────────────────────────────────────────────────────────────
// READ / UPDATE / DELETE
// ───────────────────────────────────────────────────────────────────────────────
router.get("/", getAllForms);

router.post("/forms/:id/delete", deleteForm);
router.post("/form/:id/delete", deleteForm);
router.delete("/form/:id", deleteForm);
router.get("/duplicateforms", getDuplicateForms);

router.post("/forms/leave", saveLeaveDate);
router.post("/forms/archive", archiveForm);
router.post("/forms/restore", restoreForm);

router.put("/update/:id", updateProfile);
router.get("/forms", getForms);
router.post("/leave", processLeave);

router.get("/forms/archived", getArchivedForms);
router.get("/form/:id", getFormById);

router.post("/forms/:id/shift-preview", async (req, res) => {
  try {
    const { targetUnitId, targetBedNo, effectiveDate } = req.body || {};
    const shiftDate = new Date(effectiveDate);
    if (!targetUnitId || Number.isNaN(shiftDate.getTime())) return res.status(400).json({ message: "Target unit and valid shift date are required" });

    const [tenant, targetUnit] = await Promise.all([
      Form.findOne(scopedQuery(req, { _id: req.params.id })).lean(),
      Room.findOne(scopedQuery(req, { _id: targetUnitId })).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    if (!targetUnit) return res.status(404).json({ message: "Target unit not found" });
    if (tenant.joiningDate && shiftDate < new Date(tenant.joiningDate)) return res.status(400).json({ message: "Shift date cannot be before joining date" });

    const propertyType = normalizePropertyType(targetUnit.propertyType);
    const currentPropertyType = tenantPropertyType(tenant);
    if (propertyType !== currentPropertyType) {
      return res.status(400).json({
        message: `${propertyTypeLabel(currentPropertyType)} tenant can only be shifted to another ${propertyTypeLabel(currentPropertyType).toLowerCase()}.`,
      });
    }
    const beds = Array.isArray(targetUnit.beds) ? targetUnit.beds : [];
    const selectedBed = propertyType === "bed" ? beds.find((bed) => String(bed.bedNo) === String(targetBedNo || "")) : beds[0];
    if (!selectedBed) return res.status(400).json({ message: "Select a valid rentable destination" });

    const update = {
      roomNo: targetUnit.roomNo || "",
      hasWing: Boolean(targetUnit.hasWing && targetUnit.wingName),
      wingName: targetUnit.wingName || "",
      bedNo: selectedBed.bedNo || "",
      baseRent: Number(selectedBed.price || tenant.baseRent || 0),
      shiftEffectiveFrom: shiftDate,
    };
    const prospective = { ...tenant, ...update, ...appendRentHistorySnapshot(tenant, update) };
    const cycle = getRentCycleForDate(prospective, shiftDate);
    if (!cycle) return res.status(400).json({ message: "Unable to resolve tenant billing cycle" });
    const breakdown = getRentProrationForMonth(prospective, cycle.y, cycle.m);
    res.json({
      month: cycle.month,
      cycleStart: breakdown.cycleStart,
      cycleEnd: breakdown.cycleEnd,
      totalDays: breakdown.totalDays,
      expected: breakdown.expected,
      segments: breakdown.segments.map((segment) => ({ ...segment, amount: Number(segment.amount.toFixed(2)) })),
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to calculate shift rent", error: error.message });
  }
});

router.post("/forms/:id/shift", async (req, res) => {
  try {
    const { targetUnitId, targetBedNo, effectiveDate } = req.body || {};
    if (!targetUnitId || !effectiveDate) {
      return res.status(400).json({ message: "Target unit and effective date are required" });
    }

    const [tenant, targetUnit] = await Promise.all([
      Form.findOne(scopedQuery(req, { _id: req.params.id })),
      Room.findOne(scopedQuery(req, { _id: targetUnitId })).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    if (!targetUnit) return res.status(404).json({ message: "Target unit not found" });
    if (tenant.joiningDate && new Date(effectiveDate) < new Date(tenant.joiningDate)) return res.status(400).json({ message: "Shift date cannot be before joining date" });

    const propertyType = normalizePropertyType(targetUnit.propertyType);
    const currentPropertyType = tenantPropertyType(tenant);
    if (propertyType !== currentPropertyType) {
      return res.status(400).json({
        message: `${propertyTypeLabel(currentPropertyType)} tenant can only be shifted to another ${propertyTypeLabel(currentPropertyType).toLowerCase()}.`,
      });
    }
    const beds = Array.isArray(targetUnit.beds) ? targetUnit.beds : [];
    const selectedBed = propertyType === "bed"
      ? beds.find((bed) => String(bed.bedNo) === String(targetBedNo || ""))
      : beds[0];
    if (!selectedBed) {
      return res.status(400).json({ message: propertyType === "bed" ? "Select a valid bed" : "Unit has no rentable slot" });
    }

    const unitMatch = {
      $or: [
        { roomId: String(targetUnit._id) },
        { category: targetUnit.category || "", roomNo: targetUnit.roomNo || "" },
      ],
    };
    const occupancyQuery = propertyType === "bed"
      ? { ...unitMatch, bedNo: String(selectedBed.bedNo), _id: { $ne: tenant._id } }
      : { ...unitMatch, _id: { $ne: tenant._id } };
    const candidates = await Form.find(scopedQuery(req, occupancyQuery))
      .select("_id name leaveDate")
      .lean();
    const occupant = candidates.find(isActiveTenant);
    if (occupant) {
      return res.status(409).json({ message: `Target is occupied by ${occupant.name || "another tenant"}` });
    }

    const previous = tenant.toObject();
    const update = {
      category: targetUnit.category || "",
      propertyType,
      roomId: String(targetUnit._id),
      hasWing: Boolean(targetUnit.hasWing && targetUnit.wingName),
      wingName: targetUnit.wingName || "",
      floorNo: targetUnit.floorNo || "",
      roomNo: targetUnit.roomNo || "",
      bedNo: selectedBed.bedNo || "",
      baseRent: Number(selectedBed.price || tenant.baseRent || 0),
      shiftEffectiveFrom: new Date(effectiveDate),
    };
    Object.assign(update, appendRentHistorySnapshot(previous, update));

    Object.assign(tenant, update);
    await tenant.save({ validateModifiedOnly: true });

    const rooms = await Room.find(scopedQuery(req)).lean();
    const unpaidRents = getUnpaidRentBeforeDate(tenant.toObject(), new Date(effectiveDate), rooms);
    res.json({ ok: true, tenant, unpaidRents });
  } catch (error) {
    res.status(500).json({ message: "Unable to shift tenant", error: error.message });
  }
});

function refreshRentSummary(rent) {
  const payments = Array.isArray(rent.payments) ? rent.payments : [];
  const latest = payments[payments.length - 1];
  rent.rentAmount = payments.reduce((sum, payment) => sum + Number(payment.rentAmount ?? payment.amount ?? 0), 0);
  rent.canteenAmount = payments.reduce((sum, payment) => sum + Number(payment.canteenAmount || 0), 0);
  rent.lightBillAmount = payments.reduce((sum, payment) => sum + Number(payment.lightBillAmount || 0), 0);
  rent.totalAmount = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  if (latest) {
    rent.date = latest.date;
    rent.paymentMode = latest.paymentMode;
    rent.utr = latest.utr || "";
    rent.note = latest.note || "";
    rent.receiptUrl = latest.receiptUrl || "";
  }
}

async function resolveTenantRentDueIfClear(req, tenant) {
  const rooms = await Room.find(scopedQuery(req)).lean();
  const stillDue = getUnpaidRentBeforeDate(
    typeof tenant.toObject === "function" ? tenant.toObject() : tenant,
    new Date(),
    rooms
  );
  if (stillDue.length) return;

  await resolveNotifications({
    organizationId: tenant.organizationId || req.organizationId,
    entityType: "tenant",
    entityId: tenant._id,
    actionType: "rent_due",
  });
}

router.patch("/forms/:id/rents/:rentId/payments/:paymentIndex", async (req, res) => {
  try {
    const tenant = await Form.findOne(scopedQuery(req, { _id: req.params.id }));
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const rent = tenant.rents.id(req.params.rentId);
    if (!rent) return res.status(404).json({ message: "Rent month not found" });

    if (!rent.payments?.length) {
      rent.payments = [{
        amount: rent.rentAmount,
        date: rent.date,
        paymentMode: rent.paymentMode,
        utr: rent.utr || "",
        note: rent.note || "",
        receiptUrl: rent.receiptUrl || "",
      }];
    }

    const index = Number(req.params.paymentIndex);
    if (!Number.isInteger(index) || index < 0 || index >= rent.payments.length) {
      return res.status(404).json({ message: "Payment transaction not found" });
    }

    const amount = Number(req.body.amount);
    const date = new Date(req.body.date);
    const month = String(req.body.month || rent.month).trim();
    const paymentMode = req.body.paymentMode === "Online" ? "Online" : "Cash";
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: "Payment amount must be greater than zero" });
    if (Number.isNaN(date.getTime())) return res.status(400).json({ message: "Valid payment date is required" });
    if (!/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2}$/.test(month)) return res.status(400).json({ message: "Valid rent month is required" });

    const previous = { month: rent.month, ...rent.payments[index].toObject() };
    const next = {
      _id: previous._id,
      amount,
      rentAmount: Number(req.body.rentAmount ?? amount),
      canteenAmount: Number(req.body.canteenAmount || 0),
      lightBillAmount: Number(req.body.lightBillAmount || 0),
      extraAmount: Number(req.body.extraAmount || 0),
      date,
      paymentMode,
      utr: paymentMode === "Online" ? String(req.body.utr || "").trim() : "",
      note: String(req.body.note || "").trim(),
      receiptUrl: String(req.body.receiptUrl || "").trim(),
    };

    if (month === rent.month) {
      Object.assign(rent.payments[index], next);
      refreshRentSummary(rent);
    } else {
      rent.payments.splice(index, 1);
      if (rent.payments.length) refreshRentSummary(rent);
      else tenant.rents.pull(rent._id);

      let targetRent = tenant.rents.find((entry) => entry.month === month);
      if (!targetRent) {
        tenant.rents.push({ rentAmount: 0, date, month, paymentMode, payments: [] });
        targetRent = tenant.rents[tenant.rents.length - 1];
      }
      targetRent.payments.push(next);
      refreshRentSummary(targetRent);
    }

    tenant.paymentAudit.push({
      action: "edit",
      changedBy: req.systemUser?._id || req.admin?._id || null,
      previous,
      next: { month, ...next },
    });
    tenant.markModified("rents");
    await tenant.save({ validateModifiedOnly: true });
    await writeAuditLog(req, {
      entityType: "rentPayment",
      entityId: previous._id,
      action: "update",
      before: { tenantId: tenant._id, tenantName: tenant.name, rentId: rent._id, ...previous },
      after: { tenantId: tenant._id, tenantName: tenant.name, month, ...next },
      changes: diffRecords(previous, { month, ...next }, ["month", "amount", "date", "paymentMode", "utr", "note", "receiptUrl"]),
    });
    await resolveTenantRentDueIfClear(req, tenant);
    res.json({ ok: true, tenant });
  } catch (error) {
    res.status(500).json({ message: "Unable to edit payment", error: error.message });
  }
});

router.post("/forms/:id/rents/:rentId/payments/:paymentIndex/void", async (req, res) => {
  try {
    const reason = String(req.body.reason || "").trim();
    if (reason.length < 3) return res.status(400).json({ message: "A void reason is required" });

    const tenant = await Form.findOne(scopedQuery(req, { _id: req.params.id }));
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    const rent = tenant.rents.id(req.params.rentId);
    if (!rent) return res.status(404).json({ message: "Rent month not found" });

    if (!rent.payments?.length) {
      rent.payments = [{ amount: rent.rentAmount, date: rent.date, paymentMode: rent.paymentMode, utr: rent.utr || "", note: rent.note || "", receiptUrl: rent.receiptUrl || "" }];
    }
    const index = Number(req.params.paymentIndex);
    if (!Number.isInteger(index) || index < 0 || index >= rent.payments.length) return res.status(404).json({ message: "Payment transaction not found" });

    const previous = { month: rent.month, ...rent.payments[index].toObject() };
    rent.payments.splice(index, 1);
    if (rent.payments.length) refreshRentSummary(rent);
    else tenant.rents.pull(rent._id);

    tenant.paymentAudit.push({
      action: "void",
      changedBy: req.systemUser?._id || req.admin?._id || null,
      previous,
      next: { voidReason: reason },
    });
    tenant.markModified("rents");
    await tenant.save({ validateModifiedOnly: true });
    await writeAuditLog(req, {
      entityType: "rentPayment",
      entityId: previous._id,
      action: "delete",
      before: { tenantId: tenant._id, tenantName: tenant.name, rentId: rent._id, ...previous },
      after: { voidReason: reason },
      reason,
      changes: { voidReason: { before: "", after: reason } },
    });
    res.json({ ok: true, tenant });
  } catch (error) {
    res.status(500).json({ message: "Unable to void payment", error: error.message });
  }
});

router.get("/forms/:id/leave-preview", async (req, res) => {
  try {
    const leaveDate = req.query.leaveDate ? new Date(req.query.leaveDate) : new Date();
    if (Number.isNaN(leaveDate.getTime())) {
      return res.status(400).json({ message: "Valid leave date is required" });
    }
    const [tenant, rooms] = await Promise.all([
      Form.findOne(scopedQuery(req, { _id: req.params.id })).lean(),
      Room.find(scopedQuery(req)).lean(),
    ]);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const dueMonths = getUnpaidRentBeforeDate(tenant, leaveDate, rooms, { includePartialCycle: true });
    const totalDue = dueMonths.reduce((sum, month) => sum + Number(month.outstanding || 0), 0);
    const grossDeposit = Number(tenant.depositAmount || 0);
    res.json({
      tenantId: tenant._id,
      leaveDate,
      grossDeposit,
      totalDue,
      refundableDeposit: Math.max(grossDeposit - totalDue, 0),
      amountDueFromTenant: Math.max(totalDue - grossDeposit, 0),
      dueMonths,
    });
  } catch (error) {
    res.status(500).json({ message: "Unable to prepare leave settlement", error: error.message });
  }
});
// ✅ UPDATE full form record (tenant intake update)
// router.patch("/forms/:id", updateFormById);
router.put("/forms/:id", updateFormById);

// rent entry delete by monthKey
router.delete("/form/:formId/rent/:monthYear", rentAmountDel);

// rent create/update
router.put("/form/:id", updateForm);

function parseLeaveDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isActiveTenant(tenant) {
  const leaveDate = parseLeaveDate(tenant?.leaveDate);
  if (!leaveDate) return true;

  leaveDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return leaveDate > today;
}

function isSameCategory(tenant, category) {
  const tenantCategory = String(tenant?.category || "").trim();
  return !tenantCategory || !category || tenantCategory === category;
}

function normalizePropertyType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "room" || raw === "shop") return raw;
  return "bed";
}

function normalizeTenantImportPropertyType(value) {
  return normalizePropertyType(value);
}

function normalizeImportToken(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeImportPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.slice(-10);
}

function parseImportBoolean(value) {
  const raw = String(value || "").trim().toLowerCase();
  return ["true", "yes", "y", "1"].includes(raw);
}

function normalizeImportFirstRentStatus(value) {
  const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["advance_paid", "advance", "advanced_paid", "advanced", "joining_cycle_paid"].includes(raw)) {
    return "ADVANCE_PAID";
  }
  return "NOT_PAID";
}

function parseImportDateValue(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    return new Date(parsed.y, parsed.m - 1, parsed.d);
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]));

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function importCellMap(row = {}) {
  return Object.entries(row || {}).reduce((map, [key, value]) => {
    const normalized = String(key || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (normalized && map[normalized] === undefined) map[normalized] = value;
    return map;
  }, {});
}

function importValue(row, aliases = []) {
  const cells = importCellMap(row);
  for (const alias of aliases) {
    const key = String(alias || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (cells[key] !== undefined && cells[key] !== null && String(cells[key]).trim() !== "") return cells[key];
  }
  return "";
}

function normalizeTenantImportRow(row = {}, propertyType = "bed") {
  const name = String(importValue(row, ["name", "tenant_name", "tenant name"])).trim();
  const phoneNo = String(importValue(row, ["phoneNo", "phone", "mobile", "mobile_no", "mobile number"])).trim();
  const joiningDate = importValue(row, ["joiningDate", "joining_date", "join_date", "join date"]);
  const depositAmount = Number(importValue(row, ["depositAmount", "deposit", "deposit_amount"]) || 0);
  const roomNo = String(importValue(row, ["roomNo", "room_no", "room number", "room", "shopNumber", "shop_number", "shop number", "shop"])).trim();
  const category = String(importValue(row, ["category", "property", "property_name", "building"])).trim();
  const wingName = String(importValue(row, ["wingName", "wing_name", "wing", "block", "block_name", "block name"])).trim();
  const floorNo = String(importValue(row, ["floorNo", "floor_no", "floor", "floor number"])).trim();
  const flatType = String(importValue(row, ["flatType", "flat_type", "flat type", "roomType", "room_type", "room type"])).trim();
  const bedNo = propertyType === "bed"
    ? String(importValue(row, ["bedNo", "bed_no", "bed", "bed number"])).trim()
    : propertyType === "room"
    ? "ROOM-1"
    : "SHOP-1";

  if (!name) return { error: "Tenant name is required." };
  if (!/^\d{10}$/.test(normalizeImportPhone(phoneNo))) return { name, error: "A valid 10-digit phone number is required." };
  if (!roomNo) return { name, error: propertyType === "bed" ? "Room number is required." : propertyType === "room" ? "Residential room number is required." : "Shop number is required." };
  if (propertyType === "bed" && !bedNo) return { name, error: "Bed number is required for hostel import." };
  if (!Number.isFinite(depositAmount) || depositAmount < 0) return { name, error: "Deposit amount must be 0 or more." };

  return {
    name,
    phoneNo,
    joiningDate,
    depositAmount,
    firstRentStatus: normalizeImportFirstRentStatus(
      importValue(row, ["firstRentStatus", "first_rent_status", "paymentCycle", "payment_cycle", "payment cycle", "rent cycle", "cycle"])
    ),
    category,
    wingName,
    floorNo,
    flatType,
    roomNo,
    bedNo,
    address: String(importValue(row, ["address"])).trim(),
    pincode: String(importValue(row, ["pincode", "pin_code", "pin code"])).trim(),
    city: String(importValue(row, ["city"])).trim(),
    state: String(importValue(row, ["state"])).trim(),
    houseNo: String(importValue(row, ["houseNo", "house_no", "house number"])).trim(),
    nearbyPlace: String(importValue(row, ["nearbyPlace", "nearby_place", "nearby landmark", "landmark"])).trim(),
    relativeAddress1: String(importValue(row, ["relativeAddress1", "relative_address1", "relative address"])).trim(),
    relative1Relation: String(importValue(row, ["relative1Relation", "relative1_relation", "relative 1 relation"])).trim(),
    relative1Name: String(importValue(row, ["relative1Name", "relative1_name", "relative 1 name"])).trim(),
    relative1Phone: String(importValue(row, ["relative1Phone", "relative1_phone", "relative 1 phone"])).trim(),
    relative2Relation: String(importValue(row, ["relative2Relation", "relative2_relation", "relative 2 relation"])).trim(),
    relative2Name: String(importValue(row, ["relative2Name", "relative2_name", "relative 2 name"])).trim(),
    relative2Phone: String(importValue(row, ["relative2Phone", "relative2_phone", "relative 2 phone"])).trim(),
    familyMembers: Number(importValue(row, ["familyMembers", "family_members", "family members"]) || 0),
    hasCanteen: importValue(row, ["hasCanteen", "has_canteen", "canteen"]),
    shopName: String(importValue(row, ["shopName", "shop_name", "shop name"])).trim(),
    shopBusiness: String(importValue(row, ["shopBusiness", "shop_business", "shop business", "business"])).trim(),
    companyAddress: String(importValue(row, ["companyAddress", "company_address", "company address"])).trim(),
    baseRent: importValue(row, ["baseRent", "base_rent", "monthly_rent", "monthly rent", "rent"]),
  };
}

function tenantImportTypeLabel(propertyType = "bed") {
  const type = normalizeTenantImportPropertyType(propertyType);
  if (type === "room") return "residential room";
  if (type === "shop") return "commercial shop";
  return "hostel bed";
}

function detectTenantImportSheetType(rows = []) {
  const firstRow = Array.isArray(rows) ? rows.find((row) => row && typeof row === "object") : null;
  if (!firstRow) return "";

  const cells = importCellMap(firstRow);
  const headers = Object.keys(cells);

  const hasAny = (aliases = []) =>
    aliases.some((alias) => headers.includes(String(alias || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "")));

  if (hasAny(["bedNo", "bed_no", "bed", "bed number", "hasCanteen", "has_canteen", "canteen"])) {
    return "bed";
  }

  if (hasAny(["shopName", "shop_name", "shop name", "shopBusiness", "shop_business", "shop business", "shopNumber", "shop_number", "shop number", "companyAddress", "company_address", "company address"])) {
    return "shop";
  }

  if (hasAny(["flatType", "flat_type", "flat type", "roomType", "room_type", "room type", "familyMembers", "family_members", "family members"])) {
    return "room";
  }

  return "";
}

function findMatchingImportUnit(units = [], row = {}, propertyType = "bed") {
  const roomNo = normalizeImportToken(row.roomNo);
  const category = normalizeImportToken(row.category);
  const wingName = normalizeImportToken(row.wingName);
  const floorNo = normalizeImportToken(row.floorNo);
  const flatType = normalizeImportToken(row.flatType);
  const filtered = units.filter((unit) => unit.propertyType === propertyType && unit.roomNo === roomNo);
  if (!filtered.length) return null;
  return filtered.find((unit) => (!category || unit.category === category) && (!wingName || unit.wingName === wingName) && (!floorNo || unit.floorNo === floorNo) && (propertyType !== "room" || !flatType || normalizeImportToken(unit.room.flatType) === flatType))
    || filtered.find((unit) => (!category || unit.category === category) && (!wingName || unit.wingName === wingName))
    || filtered.find((unit) => !category || unit.category === category)
    || filtered[0];
}

function buildImportSlotKey({ propertyType, category, wingName, floorNo, roomNo, bedNo }) {
  const type = normalizeTenantImportPropertyType(propertyType);
  const roomToken = normalizeImportToken(roomNo);
  if (!roomToken) return "";
  const bedToken = type === "bed"
    ? normalizeImportToken(bedNo)
    : type === "room"
    ? "ROOM-1"
    : "SHOP-1";
  return [type, normalizeImportToken(category), normalizeImportToken(wingName), normalizeImportToken(floorNo), roomToken, bedToken].join("|");
}

function slotKeyForImportTenant(tenant = {}) {
  return buildImportSlotKey({
    propertyType: tenantPropertyType(tenant),
    category: tenant.category,
    wingName: tenant.wingName,
    floorNo: tenant.floorNo,
    roomNo: tenant.roomNo,
    bedNo: tenant.bedNo,
  });
}

function isImportTenantActive(tenant = {}) {
  if (tenant.intakeStatus === "pending_tenant") return false;
  return isActiveTenant(tenant);
}

function tenantPropertyType(tenant = {}) {
  const explicit = normalizePropertyType(tenant.propertyType);
  if (explicit !== "bed") return explicit;

  const bedNo = String(tenant.bedNo || "").trim().toUpperCase();
  if (bedNo === "ROOM-1") return "room";
  if (bedNo === "SHOP-1") return "shop";

  return "bed";
}

function propertyTypeLabel(value) {
  const type = normalizePropertyType(value);
  if (type === "room") return "Residential room";
  if (type === "shop") return "Shop";
  return "Hostel bed";
}

async function getVacantBeds(req, excludeTenantId) {
  const [rooms, forms] = await Promise.all([
    Room.find(scopedQuery(req)).lean(),
    Form.find(scopedQuery(req)).select("_id propertyType roomId roomNo bedNo category wingName floorNo leaveDate").lean(),
  ]);

  const roomById = new Map(rooms.map((room) => [String(room._id), room]));
  const roomForTenant = (tenant) =>
    (tenant.roomId && roomById.get(String(tenant.roomId))) ||
    rooms.find((room) =>
      String(room.roomNo || "").trim() === String(tenant.roomNo || "").trim() &&
      normalizePropertyType(room.propertyType) === normalizePropertyType(tenant.propertyType) &&
      String(room.category || "").trim() === String(tenant.category || "").trim() &&
      String(room.wingName || "").trim() === String(tenant.wingName || "").trim() &&
      String(room.floorNo || "").trim() === String(tenant.floorNo || "").trim()
    );

  const occupiedBeds = new Set();
  const occupiedRooms = new Set();
  forms.forEach((tenant) => {
    if (excludeTenantId && String(tenant._id) === String(excludeTenantId)) return;
    if (!isActiveTenant(tenant)) return;

    const room = roomForTenant(tenant);
    const roomKey = room ? String(room._id) : "";
    const roomNo = String(tenant.roomNo || "").trim();
    const bedNo = String(tenant.bedNo || "").trim();
    const propertyType = normalizePropertyType(tenant.propertyType || room?.propertyType);

    if (!roomNo || !roomKey) return;

    if (propertyType === "bed") {
      if (bedNo) occupiedBeds.add(`${roomKey}__${bedNo}`);
      return;
    }

    occupiedRooms.add(roomKey);
  });

  const vacantBeds = [];
  rooms.forEach((room) => {
    const roomNo = String(room.roomNo || "").trim();
    const propertyType = normalizePropertyType(room.propertyType);
    const roomBeds = Array.isArray(room.beds) ? room.beds : [];

    if (!roomNo || !roomBeds.length) return;

    if (propertyType !== "bed") {
      if (occupiedRooms.has(String(room._id))) return;

      const primaryBed = roomBeds[0];
      const bedNo = String(primaryBed?.bedNo || "").trim();
      if (!bedNo) return;

      vacantBeds.push({
        roomId: String(room._id),
        category: room.category || "",
        wingName: room.wingName || "",
        floorNo: room.floorNo || "",
        roomNo,
        bedNo,
        bedCategory: primaryBed?.bedCategory || "",
        price: primaryBed?.price ?? null,
      });
      return;
    }

    roomBeds.forEach((bed) => {
      const bedNo = String(bed.bedNo || "").trim();
      if (!bedNo || occupiedBeds.has(`${String(room._id)}__${bedNo}`)) return;
      vacantBeds.push({
        roomId: String(room._id),
        category: room.category || "",
        wingName: room.wingName || "",
        floorNo: room.floorNo || "",
        roomNo,
        bedNo,
        bedCategory: bed.bedCategory || "",
        price: bed.price ?? null,
      });
    });
  });

  return vacantBeds.sort((a, b) => {
    const roomCmp = String(a.roomNo).localeCompare(String(b.roomNo), undefined, { numeric: true });
    if (roomCmp !== 0) return roomCmp;
    return String(a.bedNo).localeCompare(String(b.bedNo), undefined, { numeric: true });
  });
}

// cancel leave inline route
router.post("/cancel-leave", async (req, res) => {
  const {
    id,
    roomId: requestedRoomId,
    roomNo: requestedRoomNo,
    bedNo: requestedBedNo,
    category: requestedCategory,
    wingName: requestedWingName,
    floorNo: requestedFloorNo,
  } = req.body || {};
  try {
    const tenant = await Form.findOne(scopedQuery(req, { _id: id }));
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Form not found" });
    }

    const roomNo = String(requestedRoomNo || tenant.roomNo || "").trim();
    const category = String(requestedCategory || tenant.category || "").trim();
    const wingName = String(requestedWingName || tenant.wingName || "").trim();
    const floorNo = String(requestedFloorNo || tenant.floorNo || "").trim();
    const roomId = String(requestedRoomId || tenant.roomId || "").trim();
    const room = roomId
      ? await Room.findOne(scopedQuery(req, { _id: roomId })).lean()
      : roomNo
      ? await Room.findOne(scopedQuery(req, {
          roomNo,
          category,
          wingName,
          floorNo,
          propertyType: normalizePropertyType(tenant.propertyType),
        })).lean()
      : null;
    const propertyType = normalizePropertyType(room?.propertyType || tenant.propertyType);
    const fallbackBedNo = String(room?.beds?.[0]?.bedNo || "").trim();
    const bedNo = String(requestedBedNo || tenant.bedNo || fallbackBedNo || "").trim();
    if (!roomNo || (propertyType === "bed" && !bedNo)) {
      const vacantBeds = await getVacantBeds(req, id);
      return res.status(409).json({
        success: false,
        code: "BED_REQUIRED",
        message:
          propertyType === "shop"
            ? "Please select a shop before undoing leave."
            : propertyType === "room"
            ? "Please select a room before undoing leave."
            : "Please select a room and bed before undoing leave.",
        vacantBeds,
      });
    }

    const candidates = await Form.find(scopedQuery(req, {
      propertyType,
      _id: { $ne: id },
    }))
      .select("_id name propertyType roomId roomNo bedNo category wingName floorNo leaveDate")
      .lean();
    const activeConflict = candidates.find((candidate) => {
      if (!isActiveTenant(candidate)) return false;
      const sameRoom =
        (room?._id && candidate.roomId && String(candidate.roomId) === String(room._id)) ||
        (String(candidate.roomNo || "").trim() === roomNo &&
          isSameCategory(candidate, category) &&
          String(candidate.wingName || "").trim() === wingName &&
          String(candidate.floorNo || "").trim() === floorNo);
      return sameRoom && (propertyType !== "bed" || String(candidate.bedNo || "").trim() === bedNo);
    });

    if (activeConflict) {
      const vacantBeds = await getVacantBeds(req, id);
      const conflictLabel =
        propertyType === "shop"
          ? `Old shop ${roomNo} is already occupied by ${activeConflict.name || "another tenant"}. Select another vacant shop to undo leave.`
          : propertyType === "room"
          ? `Old room ${roomNo} is already occupied by ${activeConflict.name || "another tenant"}. Select another vacant room to undo leave.`
          : `Old bed Room ${roomNo}, Bed ${bedNo} is already occupied by ${activeConflict.name || "another tenant"}. Select another vacant bed to undo leave.`;
      return res.status(409).json({
        success: false,
        code: "BED_OCCUPIED",
        message: conflictLabel,
        occupant: {
          id: activeConflict._id,
          name: activeConflict.name || "",
          roomNo: activeConflict.roomNo || "",
          bedNo: activeConflict.bedNo || "",
        },
        vacantBeds,
      });
    }

    const updated = await Form.findOneAndUpdate(
      scopedQuery(req, { _id: id }),
      {
        $set: {
          roomNo,
          bedNo,
          ...(room?._id ? { roomId: String(room._id) } : {}),
          ...(category ? { category } : {}),
          ...(wingName ? { wingName } : {}),
          ...(floorNo ? { floorNo } : {}),
        },
        $unset: {
          leaveDate: "",
          isOnLeave: "",
          leaveSettlement: "",
        },
      },
      { new: true }
    );

    res.json({ success: true, form: updated });
  } catch (error) {
    res.status(500).json({ success: false, error: "Error cancelling leave" });
  }
});

module.exports = router;
