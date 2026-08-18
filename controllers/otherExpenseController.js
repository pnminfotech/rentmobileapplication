const OtherExpense = require('../models/OtherExpense');
const { scopedQuery, scopedCreate } = require("../utils/organizationScope");
const { actorName, writeAuditLog } = require("../utils/auditLogger");

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

// POST: Create new expense
const createOtherExpense = async (req, res) => {
  try {
    const { roomNo, propertyType, buildingName, scopeName, mainAmount, expenses, date, status } = req.body;
    const normalizedExpenses = (Array.isArray(expenses) ? expenses : [expenses])
      .map(normalizeText)
      .filter(Boolean);
    const category = normalizedExpenses[0];
    const normalizedRoomNo = normalizeIdentifier(roomNo);
    const normalizedPropertyType = normalizePropertyType(propertyType);
    const normalizedScopeType = scopeTypeFor(normalizedPropertyType);
    const normalizedScopeName = normalizeText(scopeName || buildingName);
    const normalizedBuildingName = normalizedScopeName;
    const scopedRoomNo = normalizedScopeType === "hostel" ? "" : normalizedRoomNo;
    const numericAmount = Number(mainAmount);

    if (!category || !Number.isFinite(numericAmount) || numericAmount <= 0 || !date) {
      return res.status(400).json({ message: "category, amount and date are required" });
    }
    if (normalizedScopeType === "hostel" && !normalizedScopeName) {
      return res.status(400).json({ message: "Select hostel/building name" });
    }

    const { start, end } = monthRange(date);
    const duplicate = await OtherExpense.findOne(scopedQuery(req, {
      scopeType: normalizedScopeType,
      scopeName: normalizedScopeName,
      roomNo: scopedRoomNo,
      "expenses.0": category,
      date: { $gte: start, $lt: end },
    })).collation({ locale: "en", strength: 2 });
    if (duplicate) {
      return res.status(409).json({ message: "Expense already exists for this category, unit and month" });
    }

    const newExpense = new OtherExpense(scopedCreate(req, {
      roomNo: scopedRoomNo,
      propertyType: normalizedPropertyType,
      buildingName: normalizedBuildingName,
      scopeType: normalizedScopeType,
      scopeName: normalizedScopeName,
      mainAmount: numericAmount,
      expenses: normalizedExpenses,
      date,
      status,
      createdByName: actorName(req),
      updatedByName: actorName(req),
    }));
    await newExpense.save();

    await writeAuditLog(req, {
      entityType: "otherExpense",
      entityId: newExpense._id,
      action: "create",
      after: newExpense,
    });

    res.status(201).json({ message: "Other expense saved successfully", data: newExpense });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// GET: Fetch all other expenses
const getAllOtherExpenses = async (req, res) => {
  try {
    const expenses = await OtherExpense.find(scopedQuery(req)).sort({ date: -1 });
    res.status(200).json(expenses);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch other expenses", details: error.message });
  }
};

module.exports = {
  createOtherExpense,
  getAllOtherExpenses,
};
