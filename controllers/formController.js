// controllers/formController.js
const mongoose = require("mongoose");
const Form = require("../models/formModels");
const Archive = require("../models/archiveSchema");
const DuplicateForm = require("../models/DuplicateForm");
const Invite = require("../models/Invite");
const Room = require("../models/Room");
const cron = require("node-cron");
const Counter = require("../models/counterModel");
const { normalizeFirstRentCycle } = require("../routes/_helpers/firstRentCycle");
const {
  appendRentHistorySnapshot,
  getCurrentMonthlyRent,
  getExpectedRentForMonth,
  getPaidAmountForMonth,
  getUnpaidRentBeforeDate,
  parseMonthKey,
} = require("../routes/_helpers/rentHistory");
const {
  getCanteenQuoteForMonth,
} = require("../routes/_helpers/canteenBilling");
const {
  getLightBillQuoteForMonth,
  splitCollectedAmount,
} = require("../routes/_helpers/lightBillBilling");
const {
  scopedQuery,
  scopedCreate,
  scopedUpdate,
  ensureScopedDocument,
} = require("../utils/organizationScope");
const { writeAuditLog } = require("../utils/auditLogger");
const { resolveNotifications } = require("../services/notificationService");
const Organization = require("../models/Organization");
const { sendPaymentReceivedSms } = require("../services/smsService");
function normalizePropertyType(value) {
  return ["room", "shop"].includes(String(value || "").toLowerCase()) ? String(value).toLowerCase() : "bed";
}

function propertyTypeFromTenantData(data = {}) {
  const explicit = normalizePropertyType(data.propertyType);
  if (explicit !== "bed") return explicit;

  const bedNo = String(data.bedNo || "").trim().toUpperCase();
  if (bedNo === "ROOM-1") return "room";
  if (bedNo === "SHOP-1") return "shop";
  return "bed";
}

function normalizeIdentifier(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function tenantSlotFromData(data = {}) {
  const propertyType = propertyTypeFromTenantData(data);
  return {
    propertyType,
    category: normalizeIdentifier(data.category),
    floorNo: normalizeIdentifier(data.floorNo),
    roomNo: normalizeIdentifier(data.roomNo),
    bedNo: normalizeIdentifier(
      propertyType === "room" ? "ROOM-1" : propertyType === "shop" ? "SHOP-1" : data.bedNo
    ),
  };
}

function isTenantActiveForOccupancy(data = {}) {
  if (data.intakeStatus === "pending_tenant") return false;
  return !isLeaveDue(data.leaveDate);
}

async function validateTenantSlotAvailable(req, data = {}, excludeId = null) {
  if (!isTenantActiveForOccupancy(data)) return null;

  const slot = tenantSlotFromData(data);
  if (!slot.roomNo || (slot.propertyType === "bed" && !slot.bedNo)) return null;

  const query = scopedQuery(req, {
    propertyType: slot.propertyType,
    intakeStatus: { $ne: "pending_tenant" },
  });
  if (excludeId) query._id = { $ne: excludeId };

  const candidates = await Form.find(query)
    .select("name propertyType category floorNo roomNo bedNo leaveDate")
    .lean();

  const occupied = candidates.find((tenant) => {
    if (!isTenantActiveForOccupancy(tenant)) return false;
    const existingSlot = tenantSlotFromData(tenant);
    return (
      existingSlot.category === slot.category &&
      existingSlot.floorNo === slot.floorNo &&
      existingSlot.roomNo === slot.roomNo &&
      existingSlot.bedNo === slot.bedNo
    );
  });

  if (!occupied) return null;

  const unitLabel =
    slot.propertyType === "bed"
      ? `bed ${slot.bedNo} in room ${slot.roomNo}`
      : slot.propertyType === "shop"
      ? `shop ${slot.roomNo}`
      : `room ${slot.roomNo}`;

  return {
    status: 409,
    message: `This ${unitLabel} is already occupied by ${occupied.name || "another tenant"}.`,
  };
}

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseLeaveDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const raw = String(value).trim();
  if (!raw) return null;

  const ymd = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) return new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isLeaveDue(value) {
  const leave = parseLeaveDate(value);
  if (!leave) return false;

  leave.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return leave <= today;
}

function leaveDueQuery() {
  const today = dateKey();
  const endOfToday = parseLeaveDate(today);
  endOfToday.setHours(23, 59, 59, 999);

  return {
    $or: [
      { leaveDate: { $type: "string", $lte: today, $nin: [""] } },
      { leaveDate: { $type: "date", $lte: endOfToday } },
    ],
  };
}

function normalizeContactRelation(value) {
  const allowed = ["Self", "Sister", "Brother", "Father", "Husband", "Mother"];
  const raw = String(value || "").trim();
  if (!raw) return "Self";
  const match = allowed.find((relation) => relation.toLowerCase() === raw.toLowerCase());
  return match || "Self";
}

function normalizePaymentMode(value) {
  return String(value || "").trim().toLowerCase() === "online" ? "Online" : "Cash";
}

function normalizeFirstRentStatus(value) {
  return String(value || "").trim().toUpperCase() === "ADVANCE_PAID" ? "ADVANCE_PAID" : "NOT_PAID";
}

function normalizeIntakeStatus(value) {
  return String(value || "").trim() === "pending_tenant" ? "pending_tenant" : "submitted";
}

function normalizeRestoreRent(rent, fallbackDate) {
  const date = rent?.date ? new Date(rent.date) : new Date(fallbackDate);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const month = normalizeRentMonth(rent?.month, safeDate);
  if (!month) return null;

  const rentAmount = Number(rent?.rentAmount ?? rent?.amount ?? 0);
  if (!Number.isFinite(rentAmount)) return null;

  const payments = Array.isArray(rent?.payments)
    ? rent.payments
        .map((payment) => {
          const paymentDate = payment?.date ? new Date(payment.date) : safeDate;
          const safePaymentDate = Number.isNaN(paymentDate.getTime()) ? safeDate : paymentDate;
          const amount = Number(payment?.amount ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) return null;
          return {
            amount,
            date: safePaymentDate,
            paymentMode: normalizePaymentMode(payment?.paymentMode || rent?.paymentMode),
            utr: String(payment?.utr || ""),
            note: String(payment?.note || ""),
            receiptUrl: String(payment?.receiptUrl || ""),
          };
        })
        .filter(Boolean)
    : [];

  return {
    rentAmount: Math.max(rentAmount, payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)),
    date: safeDate,
    month,
    paymentMode: normalizePaymentMode(rent?.paymentMode),
    utr: String(rent?.utr || ""),
    note: String(rent?.note || ""),
    receiptUrl: String(rent?.receiptUrl || ""),
    payments,
  };
}

function sanitizeRestoredFormData(data) {
  data.propertyType = propertyTypeFromTenantData(data);
  data.intakeStatus = normalizeIntakeStatus(data.intakeStatus);
  data.firstRentStatus = normalizeFirstRentStatus(data.firstRentStatus);
  data.relative1Relation = normalizeContactRelation(data.relative1Relation);
  data.relative2Relation = normalizeContactRelation(data.relative2Relation);

  if (!data.joiningDate || Number.isNaN(new Date(data.joiningDate).getTime())) {
    data.joiningDate = new Date();
  }
  if (!Number.isFinite(Number(data.depositAmount))) data.depositAmount = 0;
  if (!Number.isFinite(Number(data.phoneNo))) data.phoneNo = 0;

  data.rents = Array.isArray(data.rents)
    ? data.rents.map((rent) => normalizeRestoreRent(rent, data.joiningDate)).filter(Boolean)
    : [];

  return data;
}

/* ============================================================================
   SrNo HELPERS
   ==========================================================================*/

// Preview next SrNo for UI only – DOES NOT touch DB
const computeNextSrNoPreview = async () => {
  const [counter, lastForm] = await Promise.all([
    Counter.findOne({ name: "form_srno" }),
    Form.findOne().sort({ srNo: -1 }).lean(),
  ]);

  const maxExisting = lastForm ? Number(lastForm.srNo) || 0 : 0;
  const currentSeq = counter ? Number(counter.seq) || 0 : 0;

  const base = Math.max(maxExisting, currentSeq);
  return base + 1;
};

// Main helper: sets Counter.seq so it is ALWAYS >= max(srNo in forms)
// and returns the NEXT srNo to use.
const assignNextSrNoAndUpdateCounter = async () => {
  const [counter, lastForm] = await Promise.all([
    Counter.findOne({ name: "form_srno" }),
    Form.findOne().sort({ srNo: -1 }).lean(),
  ]);

  const maxExisting = lastForm ? Number(lastForm.srNo) || 0 : 0;
  const currentSeq = counter ? Number(counter.seq) || 0 : 0;

  const base = Math.max(maxExisting, currentSeq);
  const next = base + 1;

  const updatedCounter = await Counter.findOneAndUpdate(
    { name: "form_srno" },
    { $set: { name: "form_srno", seq: next } },
    { new: true, upsert: true }
  );

  return updatedCounter.seq;
};

// API: used by frontend just to **show** next SrNo
const getNextSrNo = async (req, res) => {
  try {
    const [counter, lastForm] = await Promise.all([
      Counter.findOne({ name: "form_srno" }),
      Form.findOne(scopedQuery(req)).sort({ srNo: -1 }).lean(),
    ]);

    const maxExisting = lastForm ? Number(lastForm.srNo) || 0 : 0;
    const currentSeq = counter ? Number(counter.seq) || 0 : 0;

    const next = Math.max(maxExisting, currentSeq) + 1;

    return res.json({ nextSrNo: next });
  } catch (err) {
    console.error("Error getting next SrNo:", err);
    return res.status(500).json({ error: "Failed to get SrNo" });
  }
};

/* ============================================================================
   LEAVE / ARCHIVE (string leaveDate variant)
   ==========================================================================*/

const processLeave = async (req, res) => {
  try {
    const { tenantId, leaveDate, leaveSettlement } = req.body;

    if (!tenantId || !leaveDate) {
      return res.status(400).json({
        message: "tenantId and leaveDate are required",
      });
    }

    const updatedTenant = await Form.findOneAndUpdate(
      scopedQuery(req, { _id: tenantId }),
      {
        $set: {
          leaveDate,
          isOnLeave: true,
          ...(leaveSettlement ? { leaveSettlement } : {}),
        },
      },
      {
        new: true,          // return updated doc
        runValidators: false, // 🔑 SKIP schema validation
      }
    );

    if (!updatedTenant) {
      return res.status(404).json({
        message: "Form not found",
      });
    }

    if (isLeaveDue(leaveDate)) {
      const archivedTenant = await archiveAndDeleteForm(updatedTenant, req);
      return res.json({
        message: "Leave updated and tenant archived successfully",
        tenant: archivedTenant,
        archived: true,
      });
    }

    return res.json({
      message: "Leave updated successfully",
      tenant: updatedTenant,
      archived: false,
    });

  } catch (err) {
    console.error("❌ processLeave error:", err);
    return res.status(500).json({
      message: "Internal server error",
      error: err.message,
    });
  }
};



// CRON: archive by leaveDate once per day at midnight
cron.schedule("0 0 * * *", async () => {
  try {
    const today = dateKey();
    const formsToArchive = await Form.find(leaveDueQuery());

    for (const form of formsToArchive) {
      await archiveAndDeleteForm(form);
    }

    console.log(`Archived ${formsToArchive.length} records for ${today}`);
  } catch (error) {
    console.error("Error archiving records:", error);
  }
});

/* ============================================================================
   Legacy saveForm (NOT used by /api/forms – but kept for compatibility)
   Uses assignNextSrNoAndUpdateCounter so no duplicates.
   ==========================================================================*/

const saveForm = async (req, res) => {
  try {
    const nextSrNo = await assignNextSrNoAndUpdateCounter();
    const payload = scopedCreate(req, { ...(req.body || {}), srNo: String(nextSrNo) });
    payload.hasCanteen = payload.propertyType === "bed" && req.organization?.features?.canteenEnabled
      ? Boolean(payload.hasCanteen)
      : false;
    if (!payload.hasCanteen) {
      payload.canteenPlanType = "";
      payload.canteenMonthlyAmount = 0;
      payload.canteenIncludedMeals = [];
      payload.canteenStartDate = undefined;
    }

    if (!Array.isArray(payload.rentHistory)) {
      const currentRent = getCurrentMonthlyRent(payload);
      if (currentRent > 0) {
        payload.rentHistory = [
          {
            effectiveFrom: payload.joiningDate ? new Date(payload.joiningDate) : new Date(),
            roomNo: payload.roomNo != null ? String(payload.roomNo) : "",
            bedNo: payload.bedNo != null ? String(payload.bedNo) : "",
            baseRent: currentRent,
            rentAmount: currentRent,
            source: "initial",
          },
        ];
      }
    }

    console.log(
      "📥 Incoming payload to saveForm:",
      JSON.stringify(payload, null, 2)
    );
    console.log("📂 Documents received:", payload.documents);

    const slotError = await validateTenantSlotAvailable(req, payload);
    if (slotError) {
      return res.status(slotError.status).json({ message: slotError.message });
    }

    const newForm = new Form(payload);
    await newForm.save();

    res
      .status(201)
      .json({ message: "Form submitted successfully", form: newForm });
  } catch (error) {
    console.error("❌ Error in saveForm:", error);

    if (error.code === 11000 && error.keyPattern && error.keyPattern.srNo) {
      return res.status(409).json({
        message:
          "Duplicate Sr. No. detected while saving. Please try again once.",
      });
    }

    res.status(500).json({
      message: "Error submitting form",
      error: error.message,
    });
  }
};

/* ============================================================================
   READ ALL
   ==========================================================================*/

const getAllForms = async (req, res) => {
  try {
    const forms = await Form.find(scopedQuery(req));
    res.status(200).json(forms);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

/* ============================================================================
   RENT helpers
   ==========================================================================*/

const getMonthYear = (date) => {
  const d = new Date(date);
  return `${d.toLocaleString("default", {
    month: "short",
  })}-${d.getFullYear().toString().slice(-2)}`;
};

const normalizeRentMonth = (month, date) => {
  if (typeof month === "string" && month.trim()) {
    return month.trim();
  }

  const d = new Date(date);
  if (!Number.isNaN(d.getTime())) {
    return getMonthYear(d);
  }

  return null;
};

const normalizeRentEntry = (rent, fallbackDate) => {
  const rawDate = rent?.date ? new Date(rent.date) : new Date(fallbackDate);
  const safeDate = Number.isNaN(rawDate.getTime()) ? new Date() : rawDate;
  const safeMonth = normalizeRentMonth(rent?.month, safeDate);

  const rentAmount = Number(rent?.rentAmount) || 0;
  const paymentMode = rent?.paymentMode === "Online" ? "Online" : "Cash";
  const existingPayments = Array.isArray(rent?.payments)
    ? rent.payments
        .map((payment) => ({
          amount: Number(payment?.amount) || 0,
          rentAmount: Number(payment?.rentAmount ?? payment?.amount ?? 0) || 0,
          canteenAmount: Number(payment?.canteenAmount || 0) || 0,
          lightBillAmount: Number(payment?.lightBillAmount || 0) || 0,
          extraAmount: Number(payment?.extraAmount || 0) || 0,
          date: payment?.date ? new Date(payment.date) : safeDate,
          paymentMode: payment?.paymentMode === "Online" ? "Online" : "Cash",
          utr: String(payment?.utr || ""),
          note: String(payment?.note || ""),
          receiptUrl: String(payment?.receiptUrl || ""),
        }))
        .filter((payment) => payment.amount > 0 && !Number.isNaN(payment.date.getTime()))
    : [];

  return {
    rentAmount,
    canteenAmount: Number(rent?.canteenAmount || 0),
    lightBillAmount: Number(rent?.lightBillAmount || 0),
    totalAmount: Number(rent?.totalAmount || rentAmount || 0),
    date: safeDate,
    month: safeMonth,
    paymentMode,
    utr: String(rent?.utr || ""),
    note: String(rent?.note || ""),
    receiptUrl: String(rent?.receiptUrl || ""),
    payments: existingPayments.length
      ? existingPayments
      : rentAmount > 0
      ? [{
          amount: rentAmount,
          date: safeDate,
          paymentMode,
          utr: String(rent?.utr || ""),
          note: String(rent?.note || ""),
          receiptUrl: String(rent?.receiptUrl || ""),
        }]
      : [],
  };
};

const updateForm = async (req, res) => {
  const { id } = req.params;
  const {
    rentAmount,
    date,
    month,
    paymentMode,
    rentUpdateMode,
    utr,
    note,
    receiptUrl,
  } = req.body;
  const resolvedMonth = normalizeRentMonth(month, date);
  const resolvedDate = new Date(date);

  try {
    const form = await Form.findById(id);
    if (!ensureScopedDocument(req, form, res, "Form not found")) return;

    if (!resolvedMonth) {
      return res.status(400).json({
        message: "Rent month is required. Please select a valid month or date.",
      });
    }

    if (Number.isNaN(resolvedDate.getTime())) {
      return res.status(400).json({
        message: "Valid rent date is required.",
      });
    }

    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);
    if (resolvedDate > todayEnd) {
      return res.status(400).json({
        message: "Payment date cannot be in the future.",
      });
    }

    const normalizedRents = (Array.isArray(form.rents) ? form.rents : []).map((rent) =>
      normalizeRentEntry(rent, resolvedDate)
    );

    const rentIndex = normalizedRents.findIndex((rent) => rent.month === resolvedMonth);
    const incomingAmount = Number(rentAmount);
    const shouldReplace = rentUpdateMode === "replace";
    const resolvedPaymentMode = paymentMode === "Online" ? "Online" : "Cash";
    const safeReceiptUrl = String(receiptUrl || "").trim();

    if (!Number.isFinite(incomingAmount) || incomingAmount <= 0) {
      return res.status(400).json({ message: "Rent amount must be greater than zero." });
    }

    if (safeReceiptUrl && !/^https?:\/\/\S+$/i.test(safeReceiptUrl)) {
      return res.status(400).json({ message: "Receipt URL must start with http:// or https://." });
    }

    const parsedMonth = parseMonthKey(resolvedMonth);
    const rentRooms = await Room.find(scopedQuery(req)).lean();
    const expectedRent = parsedMonth ? getExpectedRentForMonth(form.toObject(), parsedMonth.y, parsedMonth.m, rentRooms) : 0;
    const paidRent = parsedMonth ? getPaidAmountForMonth(normalizedRents, parsedMonth.y, parsedMonth.m) : 0;
    const canteenQuote = await getCanteenQuoteForMonth(req, form.toObject(), resolvedMonth);
    const existingCanteenPaid = normalizedRents
      .filter((rent) => rent.month === resolvedMonth)
      .reduce((sum, rent) => sum + Number(rent.canteenAmount || 0), 0);
    const lightBillQuote = await getLightBillQuoteForMonth(req, form.toObject(), resolvedMonth);
    const existingLightBillPaid = normalizedRents
      .filter((rent) => rent.month === resolvedMonth)
      .reduce((sum, rent) => sum + Number(rent.lightBillAmount || 0), 0);
    const split = splitCollectedAmount(
      incomingAmount,
      Math.max(expectedRent - paidRent, 0),
      Math.max(Number(canteenQuote.expected || 0) - existingCanteenPaid, 0),
      Math.max(Number(lightBillQuote.expected || 0) - existingLightBillPaid, 0)
    );

    const payment = {
      amount: incomingAmount,
      rentAmount: split.rentPart,
      canteenAmount: split.canteenPart,
      lightBillAmount: split.lightBillPart,
      extraAmount: split.extraPart,
      date: resolvedDate,
      paymentMode: resolvedPaymentMode,
      utr: String(utr || "").trim(),
      note: String(note || "").trim(),
      receiptUrl: safeReceiptUrl,
    };

    if (rentIndex !== -1) {
      const existingAmount = Number(normalizedRents[rentIndex]?.rentAmount) || 0;
      const existingCanteenAmount = Number(normalizedRents[rentIndex]?.canteenAmount) || 0;
      const existingLightBillAmount = Number(normalizedRents[rentIndex]?.lightBillAmount) || 0;
      const existingTotalAmount = Number(normalizedRents[rentIndex]?.totalAmount || existingAmount + existingCanteenAmount + existingLightBillAmount) || 0;
      normalizedRents[rentIndex] = {
        ...normalizedRents[rentIndex],
        rentAmount: shouldReplace ? split.rentPart : existingAmount + split.rentPart,
        canteenAmount: shouldReplace ? split.canteenPart : existingCanteenAmount + split.canteenPart,
        lightBillAmount: shouldReplace ? split.lightBillPart : existingLightBillAmount + split.lightBillPart,
        totalAmount: shouldReplace ? incomingAmount : existingTotalAmount + incomingAmount,
        date: resolvedDate,
        month: resolvedMonth,
        paymentMode: resolvedPaymentMode,
        utr: payment.utr,
        note: payment.note,
        receiptUrl: payment.receiptUrl,
        payments: shouldReplace
          ? [payment]
          : [...normalizedRents[rentIndex].payments, payment],
      };
    } else {
      normalizedRents.push({
        rentAmount: split.rentPart,
        canteenAmount: split.canteenPart,
        lightBillAmount: split.lightBillPart,
        totalAmount: incomingAmount,
        date: resolvedDate,
        month: resolvedMonth,
        paymentMode: resolvedPaymentMode,
        utr: payment.utr,
        note: payment.note,
        receiptUrl: payment.receiptUrl,
        payments: [payment],
      });
    }

    form.rents = normalizedRents;
    await form.save({ validateModifiedOnly: true });
const organization = form.organizationId
  ? await Organization.findById(form.organizationId).lean()
  : null;

const totalExpected =
  Number(expectedRent || 0) +
  Number(canteenQuote?.expected || 0) +
  Number(lightBillQuote?.expected || 0);

const totalPaidForMonth = (form.rents || [])
  .filter((rent) => rent.month === resolvedMonth)
  .reduce(
    (sum, rent) =>
      sum + Number(rent.totalAmount || rent.rentAmount || 0),
    0
  );

sendPaymentReceivedSms({
  tenant: form,
  organization: organization || {},
  amountPaid: incomingAmount,
  billingMonth: resolvedMonth,
  balanceDue: Math.max(totalExpected - totalPaidForMonth, 0),
}).catch((err) => console.error("Payment SMS failed:", err.message));
    const savedRent = (form.rents || []).find((rent) => rent.month === resolvedMonth);
    const savedPayments = Array.isArray(savedRent?.payments) ? savedRent.payments : [];
    const savedPayment = shouldReplace ? savedPayments[0] : savedPayments[savedPayments.length - 1];
    if (savedPayment?._id) {
      const savedPaymentData = typeof savedPayment.toObject === "function" ? savedPayment.toObject() : savedPayment;
      await writeAuditLog(req, {
        entityType: "rentPayment",
        entityId: savedPayment._id,
        action: "create",
        after: {
          tenantId: form._id,
          tenantName: form.name,
          rentId: savedRent?._id,
          month: resolvedMonth,
          ...savedPaymentData,
        },
      });
    }

    const rooms = await Room.find(scopedQuery(req)).lean();
    const stillDue = getUnpaidRentBeforeDate(form.toObject(), new Date(), rooms);
    if (!stillDue.length) {
      await resolveNotifications({
        organizationId: form.organizationId || req.organizationId,
        entityType: "tenant",
        entityId: form._id,
        actionType: "rent_due",
      });
    }

    res.status(200).json(form);
  } catch (error) {
    console.error("⚠ Update rent error:", error);
    res.status(500).json({ message: "Error updating rent: " + error.message });
  }
};


const deleteForm = async (req, res) => {
  const { id } = req.params;

  try {
    const expectedPassword = String(process.env.TENANT_DELETE_PASSWORD || "1234").trim();
    const suppliedPassword = String(req.body?.password || req.get("X-Delete-Password") || "").trim();

    if (!suppliedPassword || suppliedPassword !== expectedPassword) {
      return res.status(403).json({ message: "Invalid delete password" });
    }

    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid tenant ID" });
    }

    // Tenant details can show either an active Form or an archived tenant.
    // Delete from the collection where the record actually exists.
    let source = "active";
    let deletedTenant = await Form.findOneAndDelete(scopedQuery(req, { _id: id }));
    if (!deletedTenant) {
      source = "archived";
      deletedTenant = await Archive.findOneAndDelete(scopedQuery(req, { _id: id }));
    }
    if (!deletedTenant) return res.status(404).json({ message: "Tenant not found or already deleted" });

    // Confirm deletion immediately. Slow backup cleanup must not make the mobile
    // request time out after the tenant has already been removed.
    const responsePayload = {
      ok: true,
      deletedTenantId: String(deletedTenant._id),
      source,
      message: "Tenant deleted successfully",
    };
    res.status(200).json(responsePayload);

    Promise.allSettled([
      DuplicateForm.create({
        organizationId: deletedTenant.organizationId || null,
        originalFormId: deletedTenant._id,
        formData: deletedTenant.toObject({ depopulate: true }),
        deletedAt: new Date(),
      }),
      Invite.deleteMany(scopedQuery(req, { usedByFormId: deletedTenant._id })),
    ]).then((cleanupResults) => {
      cleanupResults.forEach((result) => {
        if (result.status === "rejected") console.warn("Post-delete cleanup failed:", result.reason);
      });
    });
    return;
  } catch (error) {
    console.error("Delete tenant failed:", error);
    return res.status(500).json({ message: `Unable to delete tenant: ${error.message}` });
  }
};

const getDuplicateForms = async (req, res) => {
  try {
    const duplicateForms = await DuplicateForm.find(scopedQuery(req))
      .populate("originalFormId")
      .exec();
    res.status(200).json(duplicateForms);
  } catch (err) {
    console.error("Error fetching duplicate forms:", err.message);
    res.status(500).json({ message: "Error fetching duplicate forms" });
  }
};

/* ============================================================================
   LEAVE DATE SAVE + DAILY CHECK
   ==========================================================================*/

const saveLeaveDate = async (req, res) => {
  const { id, leaveDate } = req.body;

  try {
    const form = await Form.findById(id);
    if (!ensureScopedDocument(req, form, res, "Form not found")) return;

    form.leaveDate = new Date(leaveDate);
    await form.save();

    if (isLeaveDue(leaveDate)) {
      const archived = await archiveAndDeleteForm(form, req);
      return res.status(200).json({ form: archived, leaveDate: archived.leaveDate, archived: true });
    }

    res.status(200).json({ form, leaveDate: form.leaveDate, archived: false });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error saving leave date: " + error.message });
  }
};

const archiveDueLeavesForRequest = async (req) => {
  const expiredForms = await Form.find(scopedQuery(req, leaveDueQuery()));

  for (const form of expiredForms) {
    await archiveAndDeleteForm(form, req);
  }
};

const checkAndArchiveLeaves = async () => {
  try {
    const expiredForms = await Form.find(leaveDueQuery());

    for (let form of expiredForms) {
      await archiveAndDeleteForm(form);
    }

    console.log("Checked and archived expired leave records.");
  } catch (error) {
    console.error("Error checking and archiving leaves:", error);
  }
};

setInterval(checkAndArchiveLeaves, 24 * 60 * 60 * 1000);

const archiveAndDeleteForm = async (form, req = null) => {
  const formId = form._id;
  const archiveData = typeof form.toObject === "function"
    ? form.toObject({ depopulate: true })
    : { ...(form._doc || form) };

  delete archiveData._id;
  archiveData.originalFormId = archiveData.originalFormId || formId;
  archiveData.relative1Relation = normalizeContactRelation(archiveData.relative1Relation);
  archiveData.relative2Relation = normalizeContactRelation(archiveData.relative2Relation);

  const archiveQuery = req ? scopedQuery(req, { _id: formId }) : { _id: formId };
  const deleteQuery = req ? scopedQuery(req, { _id: formId }) : { _id: formId };

  const archivedData = await Archive.findOneAndUpdate(
    archiveQuery,
    { $set: archiveData },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
      runValidators: false,
    }
  );
  await Form.deleteOne(deleteQuery);
  return archivedData;
};

setTimeout(checkAndArchiveLeaves, 0);

/* ============================================================================
   BASIC CRUD HELPERS
   ==========================================================================*/

const getForms = async (req, res) => {
  try {
    const forms = await Form.find(scopedQuery(req));
    res.status(200).json(forms);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching forms: " + error.message });
  }
};

const archiveForm = async (req, res) => {
  const { id } = req.body;

  try {
    const formToArchive = await Form.findById(id);
    if (!ensureScopedDocument(req, formToArchive, res, "Form not found")) return;

    const archivedData = await archiveAndDeleteForm(formToArchive, req);

    res.status(200).json(archivedData);
  } catch (error) {
    res.status(500).json({ message: "Error archiving form: " + error.message });
  }
};

const restoreForm = async (req, res) => {
  const { id, allocation } = req.body;
  console.log("Restore Request ID:", id);

  try {
    const archivedData = await Archive.findOne(scopedQuery(req, { _id: id }));
    console.log("Archived Data Found:", archivedData);

    if (!archivedData) {
      return res.status(404).json({ message: "Archived data not found" });
    }

    const restoredData = archivedData.toObject();
    delete restoredData.leaveDate;
    sanitizeRestoredFormData(restoredData);

    if (allocation && typeof allocation === "object") {
      restoredData.roomId = allocation.roomId ?? restoredData.roomId;
      restoredData.propertyType = allocation.propertyType ?? restoredData.propertyType;
      restoredData.category = allocation.category ?? restoredData.category;
      restoredData.floorNo = allocation.floorNo ?? restoredData.floorNo;
      restoredData.roomNo = allocation.roomNo ?? restoredData.roomNo;
      restoredData.bedNo = allocation.bedNo ?? restoredData.bedNo;
      if (allocation.baseRent !== undefined || allocation.rentAmount !== undefined) {
        restoredData.baseRent = Number(allocation.baseRent ?? allocation.rentAmount ?? restoredData.baseRent ?? 0);
      }
    }

    const restoredRoomId = restoredData.roomId || restoredData.room || null;
    let unit = restoredRoomId && mongoose.isValidObjectId(restoredRoomId)
      ? await Room.findOne(scopedQuery(req, { _id: restoredRoomId })).lean()
      : null;
    if (!unit) {
      unit = await Room.findOne(scopedQuery(req, {
          category: restoredData.category,
          roomNo: restoredData.roomNo,
        })).lean();
    }
    const propertyType = normalizePropertyType(unit?.propertyType || restoredData.propertyType);
    restoredData.propertyType = propertyType;
    if (unit?._id) restoredData.roomId = String(unit._id);
    if (unit?.floorNo) restoredData.floorNo = unit.floorNo;
    if (unit?.category) restoredData.category = unit.category;
    if (unit?.roomNo) restoredData.roomNo = unit.roomNo;

    const occupancyQuery = propertyType === "bed"
      ? {
          category: restoredData.category,
          roomNo: restoredData.roomNo,
          bedNo: restoredData.bedNo,
        }
      : {
          category: restoredData.category,
          roomNo: restoredData.roomNo,
        };

    const activeConflict = await Form.findOne(scopedQuery(req, occupancyQuery)).select("_id name category roomNo bedNo").lean();

    if (activeConflict) {
      const unitLabel = propertyType === "shop" ? "shop" : propertyType === "room" ? "rental room" : "bed";
      return res.status(409).json({
        ok: false,
        code: "UNIT_OCCUPIED",
        message: `Previous ${unitLabel} is occupied by ${activeConflict.name || "another tenant"}. Please choose another vacant unit.`,
        conflict: activeConflict,
      });
    }

    const restoredForm = new Form(scopedCreate(req, restoredData));
    await restoredForm.save();

    await Archive.deleteOne(scopedQuery(req, { _id: id }));
    console.log("Archived Data Deleted:", id);

    res.status(200).json(restoredForm);
  } catch (error) {
    console.error("Error restoring archived data:", error.message);
    res.status(500).json({ message: `Error restoring archived data: ${error.message}` });
  }
};

const getArchivedForms = async (req, res) => {
  try {
    await archiveDueLeavesForRequest(req);
    const archivedForms = await Archive.find(scopedQuery(req));
    res.status(200).json(archivedForms);
  } catch (error) {
    res.status(500).json({
      message: "Error fetching archived forms: " + error.message,
    });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await Form.findById(id);

    if (!ensureScopedDocument(req, existing, res, "Entity not found")) return;

    const updateData = { ...(req.body || {}) };
    const nextPropertyType = updateData.propertyType || existing.propertyType;
    if (!req.organization?.features?.canteenEnabled || nextPropertyType !== "bed") {
      updateData.hasCanteen = false;
    } else if (updateData.hasCanteen !== undefined) {
      updateData.hasCanteen = Boolean(updateData.hasCanteen);
    }
    if (updateData.hasCanteen === false) {
      updateData.canteenPlanType = "";
      updateData.canteenMonthlyAmount = 0;
      updateData.canteenIncludedMeals = [];
      updateData.canteenStartDate = undefined;
    }
    const slotError = await validateTenantSlotAvailable(
      req,
      { ...existing.toObject(), ...updateData },
      id
    );
    if (slotError) {
      return res.status(slotError.status).json({ message: slotError.message });
    }

    Object.assign(updateData, normalizeFirstRentCycle(existing.toObject(), updateData));
    const rentHistoryUpdate = appendRentHistorySnapshot(existing.toObject(), updateData);
    if (rentHistoryUpdate.rentHistory) {
      Object.assign(updateData, rentHistoryUpdate);
    }

    const updatedForm = await Form.findOneAndUpdate(scopedQuery(req, { _id: id }), scopedUpdate(req, updateData), {
      new: true,
      runValidators: true,
    });

    res.status(200).json(updatedForm);
  } catch (error) {
    res.status(500).json({ message: "Server Error", error });
  }
};


const getFormById = async (req, res) => {
  try {
    const { id } = req.params;

    let form = await Form.findOne(scopedQuery(req, { _id: id }));
    if (!form) form = await Archive.findOne(scopedQuery(req, { _id: id }));

    if (!form) return res.status(404).json({ message: "Form not found" });

    res.json(form);
  } catch (error) {
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

const rentAmountDel = async (req, res) => {
  const { formId, monthYear } = req.params;

  try {
    const form = await Form.findById(formId);
    if (!ensureScopedDocument(req, form, res, "Form not found")) return;

    form.rents = form.rents.filter((rent) => rent.month !== monthYear);
    await form.save();

    res
      .status(200)
      .json({ message: "Rent entry removed successfully", form });
  } catch (error) {
    console.error("Error removing rent entry:", error);
    res.status(500).json({ message: "Failed to remove rent", error });
  }
};

const updateFormById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid form id" });
    }

    const allowed = [
      "name","phoneNo","address","joiningDate","dob","relativeAddress1",
      "propertyType","category","roomId","floorNo","roomNo","bedNo","baseRent","rentAmount","familyMembers","hasCanteen","canteenPlanType","canteenStartDate","canteenMonthlyAmount","canteenIncludedMeals","shopName","shopBusiness","companyAddress","dateOfJoiningCollege","depositAmount",
      "firstRentStatus","firstRentMonth",
      "relative1Relation","relative1Name","relative1Phone",
      "relative2Relation","relative2Name","relative2Phone",
      "pincode","city","state","houseNo","nearbyPlace",
      "documents","status","source","rentHistory","intakeStatus",
      "shiftEffectiveFrom","shiftDate","effectiveFrom",
    ];

    const body = (req.body && typeof req.body === "object") ? req.body : {}; // ✅ safe
    const update = {};

    for (const k of allowed) {
      if (body[k] !== undefined) update[k] = body[k];
    }

    const existing = await Form.findById(id);
    if (!ensureScopedDocument(req, existing, res, "Form not found")) return;
    update.propertyType = propertyTypeFromTenantData({ ...existing.toObject(), ...update });
    update.intakeStatus = normalizeIntakeStatus(update.intakeStatus || existing.intakeStatus);

    ["dob", "dateOfJoiningCollege", "canteenStartDate", "shiftEffectiveFrom", "shiftDate", "effectiveFrom"].forEach((field) => {
      if (update[field] === "") update[field] = undefined;
    });
    ["phoneNo", "depositAmount", "baseRent", "rentAmount", "familyMembers", "canteenMonthlyAmount"].forEach((field) => {
      if (update[field] === "") update[field] = undefined;
      if (update[field] !== undefined && update[field] !== null) {
        const number = Number(update[field]);
        if (Number.isFinite(number)) update[field] = number;
      }
    });
    if (update.relative1Relation !== undefined) update.relative1Relation = normalizeContactRelation(update.relative1Relation);
    if (update.relative2Relation !== undefined) update.relative2Relation = normalizeContactRelation(update.relative2Relation);
    if (update.firstRentStatus !== undefined) update.firstRentStatus = normalizeFirstRentStatus(update.firstRentStatus);
    Object.keys(update).forEach((key) => {
      if (update[key] === undefined) delete update[key];
    });

    const nextPropertyType = update.propertyType || existing.propertyType;
    if (!req.organization?.features?.canteenEnabled || nextPropertyType !== "bed") {
      update.hasCanteen = false;
    } else if (update.hasCanteen !== undefined) {
      update.hasCanteen = Boolean(update.hasCanteen);
    }
    if (update.hasCanteen === false) {
      update.canteenPlanType = "";
      update.canteenMonthlyAmount = 0;
      update.canteenIncludedMeals = [];
      update.canteenStartDate = undefined;
    }

    const slotError = await validateTenantSlotAvailable(
      req,
      { ...existing.toObject(), ...update },
      id
    );
    if (slotError) {
      return res.status(slotError.status).json({ message: slotError.message });
    }

    Object.assign(update, normalizeFirstRentCycle(existing.toObject(), update));
    const rentHistoryUpdate = appendRentHistorySnapshot(existing.toObject(), update);
    if (rentHistoryUpdate.rentHistory) {
      Object.assign(update, rentHistoryUpdate);
    }

    const updated = await Form.findOneAndUpdate(
      scopedQuery(req, { _id: id }),
      { $set: scopedUpdate(req, update) },
      { new: true, runValidators: true }
    );

    return res.json({ ok: true, form: updated });
  } catch (err) {
    console.error("updateFormById error:", err);
    const isValidation = err?.name === "ValidationError" || err?.name === "CastError";
    const isDuplicate = err?.code === 11000;
    return res.status(isDuplicate ? 409 : isValidation ? 400 : 500).json({
      message: "Failed to update form",
      error: err.message,      // ✅ important
    });
  }
};


module.exports = {
  // SrNo helpers
  getNextSrNo,
  assignNextSrNoAndUpdateCounter,

  // Rent
  rentAmountDel,
  processLeave,
  // Leave / archive
  
  getFormById,
  getForms,
  checkAndArchiveLeaves,
  updateProfile,
  getArchivedForms,
  saveLeaveDate,
  restoreForm,
  archiveForm,
updateFormById,
  // Forms CRUD
  saveForm,
  getAllForms,
  updateForm,
  deleteForm,
  getDuplicateForms,
};
