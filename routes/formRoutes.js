// routes/formRoutes.js
const express = require("express");
const router = express.Router();

// Models (used by a couple of inline routes)
const Form = require("../models/formModels");
const Room = require("../models/Room");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery } = require("../utils/organizationScope");
const { diffRecords, writeAuditLog } = require("../utils/auditLogger");
const { resolveNotifications } = require("../services/notificationService");
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
    Form.find(scopedQuery(req)).select("_id roomNo bedNo category leaveDate").lean(),
  ]);

  const roomTypeMap = new Map(
    rooms.map((room) => [String(room.roomNo || "").trim(), normalizePropertyType(room.propertyType)])
  );

  const occupiedBeds = new Set();
  const occupiedRooms = new Set();
  forms.forEach((tenant) => {
    if (excludeTenantId && String(tenant._id) === String(excludeTenantId)) return;
    if (!isActiveTenant(tenant)) return;

    const roomNo = String(tenant.roomNo || "").trim();
    const bedNo = String(tenant.bedNo || "").trim();
    const propertyType = roomTypeMap.get(roomNo) || "bed";

    if (!roomNo) return;

    if (propertyType === "bed") {
      if (bedNo) occupiedBeds.add(`${roomNo}__${bedNo}`);
      return;
    }

    occupiedRooms.add(roomNo);
  });

  const vacantBeds = [];
  rooms.forEach((room) => {
    const roomNo = String(room.roomNo || "").trim();
    const propertyType = normalizePropertyType(room.propertyType);
    const roomBeds = Array.isArray(room.beds) ? room.beds : [];

    if (!roomNo || !roomBeds.length) return;

    if (propertyType !== "bed") {
      if (occupiedRooms.has(roomNo)) return;

      const primaryBed = roomBeds[0];
      const bedNo = String(primaryBed?.bedNo || "").trim();
      if (!bedNo) return;

      vacantBeds.push({
        category: room.category || "",
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
      if (!bedNo || occupiedBeds.has(`${roomNo}__${bedNo}`)) return;
      vacantBeds.push({
        category: room.category || "",
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
  const { id, roomNo: requestedRoomNo, bedNo: requestedBedNo, category: requestedCategory } = req.body || {};
  try {
    const tenant = await Form.findOne(scopedQuery(req, { _id: id }));
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Form not found" });
    }

    const roomNo = String(requestedRoomNo || tenant.roomNo || "").trim();
    const room = roomNo ? await Room.findOne(scopedQuery(req, { roomNo })).lean() : null;
    const propertyType = normalizePropertyType(room?.propertyType);
    const fallbackBedNo = String(room?.beds?.[0]?.bedNo || "").trim();
    const bedNo = String(requestedBedNo || tenant.bedNo || fallbackBedNo || "").trim();
    const category = String(requestedCategory || tenant.category || "").trim();

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

    const conflictQuery =
      propertyType === "bed" ? { roomNo, bedNo, _id: { $ne: id } } : { roomNo, _id: { $ne: id } };

    const candidates = await Form.find(scopedQuery(req, conflictQuery))
      .select("_id name roomNo bedNo category leaveDate")
      .lean();
    const activeConflict = candidates.find((candidate) =>
      isActiveTenant(candidate) && isSameCategory(candidate, category)
    );

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
          ...(category ? { category } : {}),
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
