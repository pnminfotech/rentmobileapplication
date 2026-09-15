const express = require("express");
const CanteenAttendance = require("../models/CanteenAttendance");
const Form = require("../models/formModels");
const Organization = require("../models/Organization");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedCreate, scopedQuery } = require("../utils/organizationScope");

const router = express.Router();

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

router.use((req, res, next) => {
  if (req.systemUser?.role === "superadmin") return next();
  if (!req.organization?.features?.canteenEnabled) {
    return res.status(403).json({ message: "Canteen feature is not enabled for this organization" });
  }
  next();
});

const MEALS = ["breakfast", "lunch", "dinner"];
const STATUSES = ["present", "absent"];
const MODES = ["full_package", "per_meal", "meal_package", "guest_meal"];
const PRIMARY_MODES = ["full_package", "per_meal", "meal_package"];

function toAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function normalizeMeals(value, fallback = []) {
  const meals = Array.isArray(value) ? value : [];
  const unique = [...new Set(meals.map((meal) => String(meal || "").trim().toLowerCase()).filter((meal) => MEALS.includes(meal)))];
  return unique.length ? unique : fallback;
}

function normalizePackageBillingMethod(value) {
  return String(value || "").trim() === "fixed_monthly" ? "fixed_monthly" : "attendance_day";
}

function normalizeSettings(input = {}) {
  const requestedModes = [...new Set((Array.isArray(input.activeModes) ? input.activeModes : [])
    .map((mode) => String(mode || "").trim().toLowerCase())
    .filter((mode) => MODES.includes(mode)))];
  const primaryMode = requestedModes.find((mode) => PRIMARY_MODES.includes(mode)) || "";
  const activeModes = [
    ...(primaryMode ? [primaryMode] : []),
    ...(requestedModes.includes("guest_meal") ? ["guest_meal"] : []),
  ];

  const settings = {
    isConfigured: false,
    activeModes,
    fullPackage: {
      monthlyAmount: toAmount(input.fullPackage?.monthlyAmount),
      billingMethod: normalizePackageBillingMethod(input.fullPackage?.billingMethod),
      includedMeals: normalizeMeals(input.fullPackage?.includedMeals, ["breakfast", "lunch", "dinner"]),
    },
    perMeal: {
      breakfast: toAmount(input.perMeal?.breakfast),
      lunch: toAmount(input.perMeal?.lunch),
      dinner: toAmount(input.perMeal?.dinner),
    },
    mealPackage: {
      name: String(input.mealPackage?.name || "Meal package").trim() || "Meal package",
      monthlyAmount: toAmount(input.mealPackage?.monthlyAmount),
      billingMethod: normalizePackageBillingMethod(input.mealPackage?.billingMethod),
      includedMeals: normalizeMeals(input.mealPackage?.includedMeals, ["lunch", "dinner"]),
    },
    guestMeal: {
      breakfast: toAmount(input.guestMeal?.breakfast),
      lunch: toAmount(input.guestMeal?.lunch),
      dinner: toAmount(input.guestMeal?.dinner),
    },
    updatedAt: new Date(),
  };

  const errors = [];
  if (!primaryMode) errors.push("Choose one main canteen billing type");
  if (primaryMode === "full_package" && settings.fullPackage.monthlyAmount <= 0) errors.push("Full food package amount is required");
  if (primaryMode === "per_meal" && !MEALS.some((meal) => settings.perMeal[meal] > 0)) errors.push("At least one per-meal price is required");
  if (primaryMode === "meal_package" && settings.mealPackage.monthlyAmount <= 0) errors.push("Meal package amount is required");
  if (activeModes.includes("guest_meal") && !MEALS.some((meal) => settings.guestMeal[meal] > 0)) errors.push("At least one guest meal price is required");

  settings.isConfigured = Boolean(primaryMode) && errors.length === 0;
  return { settings, errors };
}

function publicSettings(organization) {
  const settings = organization?.canteenSettings || {};
  return {
    enabled: Boolean(organization?.features?.canteenEnabled),
    isConfigured: Boolean(settings.isConfigured),
    activeModes: Array.isArray(settings.activeModes) ? settings.activeModes : [],
    fullPackage: {
      monthlyAmount: Number(settings.fullPackage?.monthlyAmount || 0),
      billingMethod: normalizePackageBillingMethod(settings.fullPackage?.billingMethod),
      includedMeals: normalizeMeals(settings.fullPackage?.includedMeals, ["breakfast", "lunch", "dinner"]),
    },
    perMeal: {
      breakfast: Number(settings.perMeal?.breakfast || 0),
      lunch: Number(settings.perMeal?.lunch || 0),
      dinner: Number(settings.perMeal?.dinner || 0),
    },
    mealPackage: {
      name: settings.mealPackage?.name || "Meal package",
      monthlyAmount: Number(settings.mealPackage?.monthlyAmount || 0),
      billingMethod: normalizePackageBillingMethod(settings.mealPackage?.billingMethod),
      includedMeals: normalizeMeals(settings.mealPackage?.includedMeals, ["lunch", "dinner"]),
    },
    guestMeal: {
      breakfast: Number(settings.guestMeal?.breakfast || 0),
      lunch: Number(settings.guestMeal?.lunch || 0),
      dinner: Number(settings.guestMeal?.dinner || 0),
    },
    updatedAt: settings.updatedAt || null,
  };
}

function settingsSnapshot(settings = {}) {
  return {
    isConfigured: Boolean(settings.isConfigured),
    activeModes: Array.isArray(settings.activeModes) ? settings.activeModes : [],
    fullPackage: {
      monthlyAmount: Number(settings.fullPackage?.monthlyAmount || 0),
      billingMethod: normalizePackageBillingMethod(settings.fullPackage?.billingMethod),
      includedMeals: normalizeMeals(settings.fullPackage?.includedMeals, ["breakfast", "lunch", "dinner"]),
    },
    perMeal: {
      breakfast: Number(settings.perMeal?.breakfast || 0),
      lunch: Number(settings.perMeal?.lunch || 0),
      dinner: Number(settings.perMeal?.dinner || 0),
    },
    mealPackage: {
      name: settings.mealPackage?.name || "Meal package",
      monthlyAmount: Number(settings.mealPackage?.monthlyAmount || 0),
      billingMethod: normalizePackageBillingMethod(settings.mealPackage?.billingMethod),
      includedMeals: normalizeMeals(settings.mealPackage?.includedMeals, ["lunch", "dinner"]),
    },
    guestMeal: {
      breakfast: Number(settings.guestMeal?.breakfast || 0),
      lunch: Number(settings.guestMeal?.lunch || 0),
      dinner: Number(settings.guestMeal?.dinner || 0),
    },
  };
}

function settingsChanged(previous = {}, next = {}) {
  return JSON.stringify(settingsSnapshot(previous)) !== JSON.stringify(settingsSnapshot(next));
}

function configuredMeals(organization) {
  const settings = publicSettings(organization);
  const primaryMode = (settings.activeModes || []).find((mode) => PRIMARY_MODES.includes(mode));
  if (!settings.isConfigured || !primaryMode) return [];
  if (primaryMode === "per_meal") {
    return MEALS.filter((meal) => Number(settings.perMeal?.[meal] || 0) > 0);
  }
  if (primaryMode === "meal_package") {
    return normalizeMeals(settings.mealPackage?.includedMeals, []);
  }
  return normalizeMeals(settings.fullPackage?.includedMeals, ["breakfast", "lunch", "dinner"]);
}

function isConfiguredMeal(req, meal) {
  if (req.systemUser?.role === "superadmin") return true;
  return configuredMeals(req.organization).includes(meal);
}

function normalizeDateKey(value) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "";
  return raw;
}

function normalizeMeal(value) {
  const raw = String(value || "").trim().toLowerCase();
  return MEALS.includes(raw) ? raw : "";
}

function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  return STATUSES.includes(raw) ? raw : "";
}

router.get("/settings", async (req, res) => {
  try {
    res.json(publicSettings(req.organization));
  } catch (err) {
    res.status(500).json({ message: "Unable to load canteen settings", error: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { settings, errors } = normalizeSettings(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors.join(". ") });

    const existing = await Organization.findOne({ _id: req.organizationId });
    if (!existing) return res.status(404).json({ message: "Organization not found" });

    const now = new Date();
    const history = Array.isArray(existing.canteenSettingsHistory) ? [...existing.canteenSettingsHistory] : [];
    if (settingsChanged(existing.canteenSettings || {}, settings)) {
      if (!history.length && existing.canteenSettings?.isConfigured) {
        history.push({
          effectiveFrom: existing.canteenSettings.updatedAt || existing.updatedAt || existing.createdAt || now,
          settings: existing.canteenSettings,
        });
      }
      history.push({ effectiveFrom: now, settings });
    } else if (!history.length && settings.isConfigured) {
      history.push({ effectiveFrom: settings.updatedAt || now, settings });
    }

    existing.canteenSettings = settings;
    existing.canteenSettingsHistory = history;
    const organization = await existing.save();
    if (!organization) return res.status(404).json({ message: "Organization not found" });

    res.json({ message: "Canteen settings saved", settings: publicSettings(organization) });
  } catch (err) {
    res.status(500).json({ message: "Unable to save canteen settings", error: err.message });
  }
});

function activeCanteenTenantQuery(req, dateKey) {
  const dayEnd = new Date(`${dateKey}T23:59:59.999Z`);
  return scopedQuery(req, {
    propertyType: "bed",
    hasCanteen: true,
    intakeStatus: { $ne: "pending_tenant" },
    joiningDate: { $lte: dayEnd },
    $or: [
      { leaveDate: { $exists: false } },
      { leaveDate: null },
      { leaveDate: "" },
      { leaveDate: { $type: "date", $gte: dayEnd } },
      { leaveDate: { $type: "string", $gte: dateKey } },
    ],
  });
}

function tenantPayload(tenant, record) {
  return {
    _id: tenant._id,
    srNo: tenant.srNo,
    name: tenant.name,
    phoneNo: tenant.phoneNo,
    category: tenant.category,
    floorNo: tenant.floorNo,
    roomNo: tenant.roomNo,
    bedNo: tenant.bedNo,
    hasCanteen: tenant.hasCanteen,
    status: record?.status || "unmarked",
    attendanceId: record?._id || null,
    markedAt: record?.markedAt || null,
  };
}

router.get("/range", async (req, res) => {
  try {
    const start = normalizeDateKey(req.query.start);
    const end = normalizeDateKey(req.query.end);
    const meal = req.query.meal ? normalizeMeal(req.query.meal) : "";

    if (req.query.start && !start) return res.status(400).json({ message: "Valid start date is required in YYYY-MM-DD format" });
    if (req.query.end && !end) return res.status(400).json({ message: "Valid end date is required in YYYY-MM-DD format" });
    if (req.query.meal && !meal) return res.status(400).json({ message: "Valid meal is required" });

    const query = scopedQuery(req);
    if (start || end) {
      query.dateKey = {};
      if (start) query.dateKey.$gte = start;
      if (end) query.dateKey.$lte = end;
    }
    if (meal) query.meal = meal;

    const records = await CanteenAttendance.find(query)
      .sort({ dateKey: -1, meal: 1, createdAt: -1 })
      .populate("tenantId", "srNo name phoneNo category floorNo roomNo bedNo hasCanteen")
      .lean();

    const rows = records.map((record) => {
      const tenant = record.tenantId || {};
      return {
        _id: record._id,
        tenantId: tenant._id || record.tenantId,
        tenantName: tenant.name || "",
        phoneNo: tenant.phoneNo || "",
        srNo: tenant.srNo || "",
        category: tenant.category || "",
        floorNo: tenant.floorNo || "",
        roomNo: tenant.roomNo || "",
        bedNo: tenant.bedNo || "",
        hasCanteen: tenant.hasCanteen !== false,
        dateKey: record.dateKey,
        meal: record.meal,
        status: record.status,
        markedAt: record.markedAt,
      };
    });

    const summary = rows.reduce(
      (result, row) => {
        result.total += 1;
        if (row.status === "present") result.present += 1;
        if (row.status === "absent") result.absent += 1;
        return result;
      },
      { total: 0, present: 0, absent: 0 }
    );

    res.json({ rows, summary });
  } catch (err) {
    res.status(500).json({ message: "Unable to load canteen attendance records", error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const dateKey = normalizeDateKey(req.query.date || new Date().toISOString().slice(0, 10));
    const meal = normalizeMeal(req.query.meal || "breakfast");

    if (!dateKey) return res.status(400).json({ message: "Valid date is required in YYYY-MM-DD format" });
    if (!meal) return res.status(400).json({ message: "Valid meal is required" });
    if (!isConfiguredMeal(req, meal)) return res.status(400).json({ message: "This meal is not enabled in canteen settings" });

    const tenants = await Form.find(activeCanteenTenantQuery(req, dateKey))
      .sort({ category: 1, floorNo: 1, roomNo: 1, bedNo: 1, name: 1 })
      .select("srNo name phoneNo category floorNo roomNo bedNo hasCanteen")
      .lean();

    const tenantIds = tenants.map((tenant) => tenant._id);
    const records = await CanteenAttendance.find(scopedQuery(req, {
      tenantId: { $in: tenantIds },
      dateKey,
      meal,
    })).lean();

    const recordMap = new Map(records.map((record) => [String(record.tenantId), record]));
    const rows = tenants.map((tenant) => tenantPayload(tenant, recordMap.get(String(tenant._id))));
    const summary = rows.reduce(
      (result, row) => {
        result.total += 1;
        if (row.status === "present") result.present += 1;
        else if (row.status === "absent") result.absent += 1;
        else result.unmarked += 1;
        return result;
      },
      { total: 0, present: 0, absent: 0, unmarked: 0 }
    );

    res.json({ dateKey, meal, summary, rows });
  } catch (err) {
    res.status(500).json({ message: "Unable to load canteen attendance", error: err.message });
  }
});

router.post("/mark", async (req, res) => {
  try {
    const dateKey = normalizeDateKey(req.body.dateKey);
    const meal = normalizeMeal(req.body.meal);
    const status = normalizeStatus(req.body.status);
    const tenantId = String(req.body.tenantId || "").trim();

    if (!dateKey) return res.status(400).json({ message: "Valid dateKey is required" });
    if (!meal) return res.status(400).json({ message: "Valid meal is required" });
    if (!isConfiguredMeal(req, meal)) return res.status(400).json({ message: "This meal is not enabled in canteen settings" });
    if (!status) return res.status(400).json({ message: "Valid status is required" });
    if (!tenantId) return res.status(400).json({ message: "tenantId is required" });

    const tenantQuery = activeCanteenTenantQuery(req, dateKey);
    tenantQuery._id = tenantId;
    const tenant = await Form.findOne(tenantQuery).lean();
    if (!tenant) return res.status(404).json({ message: "Canteen tenant not found" });

    const record = await CanteenAttendance.findOneAndUpdate(
      scopedQuery(req, { tenantId, dateKey, meal }),
      scopedCreate(req, {
        tenantId,
        dateKey,
        meal,
        status,
        markedBy: req.admin?._id || req.user?._id || null,
        markedAt: new Date(),
      }),
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();

    res.json({ message: "Canteen attendance updated", record });
  } catch (err) {
    res.status(500).json({ message: "Unable to update canteen attendance", error: err.message });
  }
});

router.post("/bulk", async (req, res) => {
  try {
    const dateKey = normalizeDateKey(req.body.dateKey);
    const meal = normalizeMeal(req.body.meal);
    const status = normalizeStatus(req.body.status);

    if (!dateKey) return res.status(400).json({ message: "Valid dateKey is required" });
    if (!meal) return res.status(400).json({ message: "Valid meal is required" });
    if (!isConfiguredMeal(req, meal)) return res.status(400).json({ message: "This meal is not enabled in canteen settings" });
    if (!status) return res.status(400).json({ message: "Valid status is required" });

    const tenants = await Form.find(activeCanteenTenantQuery(req, dateKey)).select("_id").lean();
    const now = new Date();
    const markedBy = req.admin?._id || req.user?._id || null;

    if (tenants.length) {
      await CanteenAttendance.bulkWrite(
        tenants.map((tenant) => ({
          updateOne: {
            filter: scopedQuery(req, { tenantId: tenant._id, dateKey, meal }),
            update: {
              $set: {
                status,
                markedBy,
                markedAt: now,
                organizationId: req.organizationId || null,
              },
              $setOnInsert: {
                tenantId: tenant._id,
                dateKey,
                meal,
              },
            },
            upsert: true,
          },
        })),
        { ordered: false }
      );
    }

    res.json({ message: "Canteen attendance updated", count: tenants.length });
  } catch (err) {
    res.status(500).json({ message: "Unable to update canteen attendance", error: err.message });
  }
});

module.exports = router;
