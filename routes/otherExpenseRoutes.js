const express = require('express');
const router = express.Router();
const { createOtherExpense, getAllOtherExpenses } = require('../controllers/otherExpenseController');
const OtherExpense = require('../models/OtherExpense')
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery, scopedUpdate } = require("../utils/organizationScope");
const { actorName, diffRecords, writeAuditLog } = require("../utils/auditLogger");
router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value) {
  return normalizeText(value).toUpperCase();
}

function normalizePropertyType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "room" || raw === "shop") return raw;
  return "bed";
}

function scopeTypeFor(propertyType) {
  const normalized = normalizePropertyType(propertyType);
  if (normalized === "room" || normalized === "shop") return normalized;
  return "hostel";
}

function monthRange(value) {
  const entryDate = new Date(value);
  return {
    start: new Date(entryDate.getFullYear(), entryDate.getMonth(), 1),
    end: new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 1),
  };
}

// POST /api/other-expense/
router.post('/', createOtherExpense);

// GET /api/other-expense/
router.get('/all', getAllOtherExpenses);


// Update Other Expense
router.put('/:id', async (req, res) => {
  try {
    const current = await OtherExpense.findOne(scopedQuery(req, { _id: req.params.id }));
    if (!current) return res.status(404).json({ message: 'Other Expense not found' });
    const before = current.toObject();

    const update = { ...req.body };
    if (update.roomNo !== undefined) update.roomNo = normalizeIdentifier(update.roomNo);
    if (update.propertyType !== undefined) update.propertyType = normalizePropertyType(update.propertyType);
    if (update.buildingName !== undefined) update.buildingName = normalizeText(update.buildingName);
    if (update.scopeName !== undefined) update.scopeName = normalizeText(update.scopeName);
    if (update.expenses !== undefined) {
      update.expenses = (Array.isArray(update.expenses) ? update.expenses : [update.expenses])
        .map(normalizeText)
        .filter(Boolean);
    }
    if (update.mainAmount !== undefined) {
      const amount = Number(update.mainAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ message: "Enter a valid amount" });
      }
      update.mainAmount = amount;
    }

    const nextExpenses = update.expenses ?? current.expenses ?? [];
    const category = nextExpenses[0];
    const nextPropertyType = update.propertyType ?? current.propertyType ?? "bed";
    const nextScopeType = scopeTypeFor(nextPropertyType);
    const nextScopeName = update.scopeName ?? update.buildingName ?? current.scopeName ?? current.buildingName ?? "";
    const nextRoomNo = nextScopeType === "hostel" ? "" : update.roomNo ?? current.roomNo ?? "";
    update.scopeType = nextScopeType;
    update.scopeName = nextScopeName;
    update.buildingName = nextScopeName;
    update.roomNo = nextRoomNo;

    const nextDate = update.date ?? current.date;
    const { start, end } = monthRange(nextDate);
    const duplicate = await OtherExpense.findOne(scopedQuery(req, {
      _id: { $ne: req.params.id },
      scopeType: nextScopeType,
      scopeName: nextScopeName,
      roomNo: nextRoomNo,
      "expenses.0": category,
      date: { $gte: start, $lt: end },
    })).collation({ locale: "en", strength: 2 });
    if (duplicate) {
      return res.status(409).json({ message: "Expense already exists for this category, unit and month" });
    }

    const otherExpense = await OtherExpense.findOneAndUpdate(
      scopedQuery(req, { _id: req.params.id }),
      scopedUpdate(req, { ...update, updatedByName: actorName(req) }),
      { new: true }
    );
    if (!otherExpense) return res.status(404).json({ message: 'Other Expense not found' });
    await writeAuditLog(req, {
      entityType: "otherExpense",
      entityId: otherExpense._id,
      action: "update",
      before,
      after: otherExpense,
      changes: diffRecords(before, otherExpense, ["roomNo", "propertyType", "buildingName", "scopeType", "scopeName", "mainAmount", "expenses", "date", "status"]),
    });
    res.json(otherExpense);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// Delete Other Expense
router.delete('/:id', async (req, res) => {
  try {
    const otherExpense = await OtherExpense.findOneAndDelete(scopedQuery(req, { _id: req.params.id }));
    if (!otherExpense) return res.status(404).json({ message: 'Other Expense not found' });
    await writeAuditLog(req, {
      entityType: "otherExpense",
      entityId: otherExpense._id,
      action: "delete",
      before: otherExpense,
      reason: req.body?.reason || "",
    });
    res.json({ message: 'Other Expense deleted successfully' });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
