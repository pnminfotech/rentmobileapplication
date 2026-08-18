const CanteenAttendance = require("../../models/CanteenAttendance");
const { scopedQuery } = require("../../utils/organizationScope");

const MEALS = ["breakfast", "lunch", "dinner"];

function parseMonthKey(value) {
  const match = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].indexOf(match[1]);
  return { y: 2000 + Number(match[2]), m: month };
}

function monthDateRange(monthKey) {
  const parsed = parseMonthKey(monthKey);
  if (!parsed) return null;
  const start = new Date(parsed.y, parsed.m, 1);
  const end = new Date(parsed.y, parsed.m + 1, 0, 23, 59, 59, 999);
  const startKey = `${parsed.y}-${String(parsed.m + 1).padStart(2, "0")}-01`;
  const endKey = `${parsed.y}-${String(parsed.m + 1).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { start, end, startKey, endKey, daysInMonth: end.getDate() };
}

function activePrimaryMode(settings = {}, tenant = {}) {
  if (tenant.canteenPlanType) return tenant.canteenPlanType;
  const modes = Array.isArray(settings.activeModes) ? settings.activeModes : [];
  return modes.find((mode) => ["full_package", "per_meal", "meal_package"].includes(mode)) || "";
}

function fixedTenantAmount(tenant = {}, fallback = 0) {
  const amount = Number(tenant.canteenMonthlyAmount || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : Number(fallback || 0);
}

function canCalculateCanteen(req, tenant = {}, monthKey = "") {
  if (!req.organization?.features?.canteenEnabled) return false;
  if (!tenant.hasCanteen || tenant.propertyType !== "bed") return false;
  const range = monthDateRange(monthKey);
  if (!range) return false;
  if (tenant.canteenStartDate) {
    const startDate = new Date(tenant.canteenStartDate);
    if (!Number.isNaN(startDate.getTime()) && startDate > range.end) return false;
  }
  return true;
}

async function getCanteenQuoteForMonth(req, tenant = {}, monthKey = "") {
  const range = monthDateRange(monthKey);
  const settings = req.organization?.canteenSettings || {};
  const empty = {
    enabled: Boolean(req.organization?.features?.canteenEnabled),
    applicable: false,
    mode: "",
    expected: 0,
    breakdown: [],
  };

  if (!range || !canCalculateCanteen(req, tenant, monthKey)) return empty;

  const mode = activePrimaryMode(settings, tenant);
  if (!mode) return empty;

  const records = await CanteenAttendance.find(scopedQuery(req, {
    tenantId: tenant._id,
    dateKey: { $gte: range.startKey, $lte: range.endKey },
    status: "present",
  })).lean();

  const counts = records.reduce((result, record) => {
    if (MEALS.includes(record.meal)) result[record.meal] += 1;
    return result;
  }, { breakfast: 0, lunch: 0, dinner: 0 });

  function presentDaysForMeals(meals = MEALS) {
    const allowedMeals = new Set((Array.isArray(meals) && meals.length ? meals : MEALS).filter((meal) => MEALS.includes(meal)));
    const days = new Set();
    records.forEach((record) => {
      if (allowedMeals.has(record.meal)) days.add(record.dateKey);
    });
    return days.size;
  }

  if (mode === "full_package") {
    const monthlyAmount = fixedTenantAmount(tenant, settings.fullPackage?.monthlyAmount);
    const includedMeals = Array.isArray(settings.fullPackage?.includedMeals) && settings.fullPackage.includedMeals.length
      ? settings.fullPackage.includedMeals
      : MEALS;
    const presentDays = presentDaysForMeals(includedMeals);
    const dailyRate = monthlyAmount > 0 ? monthlyAmount / range.daysInMonth : 0;
    const expected = Math.round(dailyRate * presentDays);
    return {
      enabled: true,
      applicable: monthlyAmount > 0,
      mode,
      monthlyAmount,
      daysInMonth: range.daysInMonth,
      presentDays,
      mealCounts: counts,
      expected,
      breakdown: [{ label: "Full food package", amount: expected, monthlyAmount, presentDays, daysInMonth: range.daysInMonth, mealCounts: counts }],
    };
  }

  if (mode === "meal_package") {
    const monthlyAmount = fixedTenantAmount(tenant, settings.mealPackage?.monthlyAmount);
    const meals = Array.isArray(tenant.canteenIncludedMeals) && tenant.canteenIncludedMeals.length
      ? tenant.canteenIncludedMeals
      : settings.mealPackage?.includedMeals || [];
    const presentDays = presentDaysForMeals(meals);
    const dailyRate = monthlyAmount > 0 ? monthlyAmount / range.daysInMonth : 0;
    const expected = Math.round(dailyRate * presentDays);
    return {
      enabled: true,
      applicable: monthlyAmount > 0,
      mode,
      monthlyAmount,
      daysInMonth: range.daysInMonth,
      presentDays,
      mealCounts: counts,
      expected,
      breakdown: [{ label: `Meal package${meals.length ? ` (${meals.join(", ")})` : ""}`, amount: expected, monthlyAmount, presentDays, daysInMonth: range.daysInMonth, mealCounts: counts }],
    };
  }

  if (mode === "per_meal") {
    const prices = settings.perMeal || {};
    const breakdown = MEALS.map((meal) => {
      const count = counts[meal] || 0;
      const rate = Number(prices[meal] || 0);
      return { label: meal, count, rate, amount: count * rate };
    }).filter((item) => item.amount > 0);
    const expected = breakdown.reduce((sum, item) => sum + item.amount, 0);
    return { enabled: true, applicable: true, mode, expected, mealCounts: counts, breakdown };
  }

  return empty;
}

function splitCollectedAmount(totalAmount, rentBalance, canteenBalance) {
  const total = Math.max(Number(totalAmount || 0), 0);
  const rentPart = Math.min(total, Math.max(Number(rentBalance || 0), 0));
  const canteenPart = Math.min(Math.max(total - rentPart, 0), Math.max(Number(canteenBalance || 0), 0));
  const extraPart = Math.max(total - rentPart - canteenPart, 0);
  return { rentPart, canteenPart, extraPart };
}

module.exports = {
  getCanteenQuoteForMonth,
  splitCollectedAmount,
};
