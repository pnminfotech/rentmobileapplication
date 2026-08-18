const express = require("express");
const StaffExpense = require("../models/StaffExpense");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery, scopedCreate, scopedUpdate } = require("../utils/organizationScope");
const { actorName, diffRecords, writeAuditLog } = require("../utils/auditLogger");

const router = express.Router();

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function monthRange(value) {
  const entryDate = new Date(value);
  return {
    start: new Date(entryDate.getFullYear(), entryDate.getMonth(), 1),
    end: new Date(entryDate.getFullYear(), entryDate.getMonth() + 1, 1),
  };
}

async function findDuplicateStaffExpense(req, { type, name, date, excludeId }) {
  const { start, end } = monthRange(date);
  const query = scopedQuery(req, {
    type: normalizeText(type),
    name: normalizeText(name),
    date: { $gte: start, $lt: end },
  });
  if (excludeId) query._id = { $ne: excludeId };
  return StaffExpense.findOne(query).collation({ locale: "en", strength: 2 });
}

// GET ALL
router.get("/all", async (req, res) => {
  try {
    const list = await StaffExpense.find(scopedQuery(req)).sort({ date: -1, createdAt: -1 });
    res.json(list);
  } catch (e) {
    res.status(500).json({ message: "Failed to load staff expenses", error: e.message });
  }
});

// CREATE
router.post("/", async (req, res) => {
  try {
    const { type, name, amount, notes, status, date } = req.body;

    if (!type || !name || amount === undefined || !date) {
      return res.status(400).json({ message: "type, name, amount, date are required" });
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ message: "Enter a valid amount" });
    }

    const duplicate = await findDuplicateStaffExpense(req, { type, name, date });
    if (duplicate) {
      return res.status(409).json({ message: "Staff expense already exists for this staff, type and month" });
    }

    const doc = await StaffExpense.create(scopedCreate(req, {
      type: normalizeText(type),
      name: normalizeText(name),
      amount: numericAmount,
      notes: notes || "",
      status: status || "pending",
      date: new Date(date),
      createdByName: actorName(req),
      updatedByName: actorName(req),
    }));

    await writeAuditLog(req, {
      entityType: "staffExpense",
      entityId: doc._id,
      action: "create",
      after: doc,
    });

    res.status(201).json(doc);
  } catch (e) {
    res.status(500).json({ message: "Failed to save staff expense", error: e.message });
  }
});

// UPDATE
router.put("/:id", async (req, res) => {
  try {
    const current = await StaffExpense.findOne(scopedQuery(req, { _id: req.params.id }));
    if (!current) return res.status(404).json({ message: "Expense not found" });
    const before = current.toObject();

    const update = { ...req.body };
    if (update.type !== undefined) update.type = normalizeText(update.type);
    if (update.name !== undefined) update.name = normalizeText(update.name);
    if (update.amount !== undefined) {
      const numericAmount = Number(update.amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ message: "Enter a valid amount" });
      }
      update.amount = numericAmount;
    }
    if (req.body.date) update.date = new Date(req.body.date);

    const duplicate = await findDuplicateStaffExpense(req, {
      type: update.type ?? current.type,
      name: update.name ?? current.name,
      date: update.date ?? current.date,
      excludeId: req.params.id,
    });
    if (duplicate) {
      return res.status(409).json({ message: "Staff expense already exists for this staff, type and month" });
    }

    const updated = await StaffExpense.findOneAndUpdate(
      scopedQuery(req, { _id: req.params.id }),
      scopedUpdate(req, { ...update, updatedByName: actorName(req) }),
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Expense not found" });
    await writeAuditLog(req, {
      entityType: "staffExpense",
      entityId: updated._id,
      action: "update",
      before,
      after: updated,
      changes: diffRecords(before, updated, ["type", "name", "amount", "notes", "status", "date"]),
    });
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: "Failed to update staff expense", error: e.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await StaffExpense.findOneAndDelete(scopedQuery(req, { _id: req.params.id }));
    if (!deleted) return res.status(404).json({ message: "Expense not found" });
    await writeAuditLog(req, {
      entityType: "staffExpense",
      entityId: deleted._id,
      action: "delete",
      before: deleted,
      reason: req.body?.reason || "",
    });
    res.json({ message: "Deleted" });
  } catch (e) {
    res.status(500).json({ message: "Failed to delete staff expense", error: e.message });
  }
});

module.exports = router;
