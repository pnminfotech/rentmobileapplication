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

function fixedTenantAmount(tenant = {}, fallback = 0, options = {}) {
  if (options.preferSettings) return Number(fallback || 0);
  const amount = Number(tenant.canteenMonthlyAmount || 0);
  return Number.isFinite(amount) && amount > 0 ? amount : Number(fallback || 0);
}

function dateFromKey(dateKey = "") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ""));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
}

function settingsForDate(organization = {}, dateKey = "") {
  const current = organization.canteenSettings || {};
  const history = Array.isArray(organization.canteenSettingsHistory)
    ? organization.canteenSettingsHistory
        .filter((entry) => entry?.settings && entry.effectiveFrom)
        .sort((a, b) => new Date(a.effectiveFrom) - new Date(b.effectiveFrom))
    : [];
  const targetDate = dateFromKey(dateKey);
  if (!targetDate) return { settings: current, fromHistory: false };
  if (!history.length) {
    const currentEffectiveFrom = current.updatedAt ? new Date(current.updatedAt) : null;
    const currentIsEffective = currentEffectiveFrom &&
      !Number.isNaN(currentEffectiveFrom.getTime()) &&
      currentEffectiveFrom <= targetDate;
    if (currentIsEffective) return { settings: current, fromHistory: true };
    return {
      settings: {
        ...current,
        fullPackage: { ...(current.fullPackage || {}), billingMethod: "attendance_day" },
        mealPackage: { ...(current.mealPackage || {}), billingMethod: "attendance_day" },
      },
      fromHistory: false,
    };
  }

  let selected = null;
  for (const entry of history) {
    const effectiveFrom = new Date(entry.effectiveFrom);
    if (!Number.isNaN(effectiveFrom.getTime()) && effectiveFrom <= targetDate) selected = entry;
  }

  return selected
    ? { settings: selected.settings || current, fromHistory: true }
    : { settings: current, fromHistory: false };
}

function groupRecordsByDate(records = []) {
  return records.reduce((map, record) => {
    if (!map.has(record.dateKey)) map.set(record.dateKey, []);
    map.get(record.dateKey).push(record);
    return map;
  }, new Map());
}

function hasMealForDay(dayRecords = [], meals = MEALS) {
  const allowedMeals = new Set((Array.isArray(meals) && meals.length ? meals : MEALS).filter((meal) => MEALS.includes(meal)));
  return dayRecords.some((record) => allowedMeals.has(record.meal));
}

function normalizePackageBillingMethod(value) {
  return String(value || "").trim() === "fixed_monthly" ? "fixed_monthly" : "attendance_day";
}

function dateKeyFromDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function startDateKeyForTenant(tenant = {}, range) {
  const tenantStart = tenant.canteenStartDate || tenant.joiningDate;
  const parsed = tenantStart ? new Date(tenantStart) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed < range.start) return range.startKey;
  return dateKeyFromDate(parsed);
}

function packageAmountForDay(tenant, settings, packageKey, fromHistory) {
  return fixedTenantAmount(tenant, settings?.[packageKey]?.monthlyAmount, { preferSettings: fromHistory });
}

function packageMealsForDay(tenant, settings, packageKey, fromHistory, fallbackMeals = MEALS) {
  if (packageKey === "mealPackage" && Array.isArray(tenant.canteenIncludedMeals) && tenant.canteenIncludedMeals.length && !fromHistory) {
    return tenant.canteenIncludedMeals;
  }
  return Array.isArray(settings?.[packageKey]?.includedMeals) && settings[packageKey].includedMeals.length
    ? settings[packageKey].includedMeals
    : fallbackMeals;
}

function addBreakdownItem(items, item) {
  const existing = items.find((row) => (
    row.label === item.label &&
    row.billingMethod === item.billingMethod &&
    Number(row.monthlyAmount || 0) === Number(item.monthlyAmount || 0) &&
    Number(row.daysInMonth || 0) === Number(item.daysInMonth || 0)
  ));
  if (existing) {
    existing.amount += item.amount;
    existing.presentDays += item.presentDays;
    return;
  }
  items.push(item);
}

function buildPackageQuote({ req, tenant, range, records, counts, mode, packageKey, label, fallbackMeals }) {
  const byDate = groupRecordsByDate(records);
  const breakdown = [];
  let expected = 0;
  let presentDays = 0;
  const activeStartKey = startDateKeyForTenant(tenant, range);
  let latestMonthlyAmount = 0;

  for (let day = 1; day <= range.daysInMonth; day += 1) {
    const dateKey = `${range.startKey.slice(0, 8)}${String(day).padStart(2, "0")}`;
    if (dateKey < activeStartKey) continue;

    const dated = settingsForDate(req.organization || {}, dateKey);
    const daySettings = dated.settings || req.organization?.canteenSettings || {};
    const packageSettings = daySettings[packageKey] || {};
    const billingMethod = normalizePackageBillingMethod(packageSettings.billingMethod);
    const monthlyAmount = packageAmountForDay(tenant, daySettings, packageKey, dated.fromHistory);
    const includedMeals = packageMealsForDay(tenant, daySettings, packageKey, dated.fromHistory, fallbackMeals);
    latestMonthlyAmount = monthlyAmount || latestMonthlyAmount;

    if (billingMethod === "fixed_monthly") {
      if (monthlyAmount <= 0) continue;
      const amount = Math.round(monthlyAmount / range.daysInMonth);
      expected += amount;
      addBreakdownItem(breakdown, {
        label,
        billingMethod,
        amount,
        monthlyAmount,
        presentDays: 1,
        daysInMonth: range.daysInMonth,
        mealCounts: counts,
      });
      continue;
    }

    const dayRecords = byDate.get(dateKey) || [];
    if (!hasMealForDay(dayRecords, includedMeals)) continue;
    const amount = monthlyAmount > 0 ? Math.round(monthlyAmount / range.daysInMonth) : 0;
    expected += amount;
    presentDays += 1;
    addBreakdownItem(breakdown, {
      label,
      billingMethod,
      amount,
      monthlyAmount,
      presentDays: 1,
      daysInMonth: range.daysInMonth,
      mealCounts: counts,
    });
  }

  return { expected, presentDays, monthlyAmount: latestMonthlyAmount, breakdown };
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
    const quote = buildPackageQuote({
      req,
      tenant,
      range,
      records,
      counts,
      mode,
      packageKey: "fullPackage",
      label: "Full food package",
      fallbackMeals: MEALS,
    });
    const { monthlyAmount, presentDays, expected, breakdown } = quote;
    return {
      enabled: true,
      applicable: monthlyAmount > 0,
      mode,
      monthlyAmount,
      daysInMonth: range.daysInMonth,
      presentDays,
      mealCounts: counts,
      expected,
      breakdown,
    };
  }

  if (mode === "meal_package") {
    const packageMeals = Array.isArray(settings.mealPackage?.includedMeals) && settings.mealPackage.includedMeals.length
      ? settings.mealPackage.includedMeals
      : [];
    const quote = buildPackageQuote({
      req,
      tenant,
      range,
      records,
      counts,
      mode,
      packageKey: "mealPackage",
      label: `Meal package${packageMeals.length ? ` (${packageMeals.join(", ")})` : ""}`,
      fallbackMeals: [],
    });
    const { monthlyAmount, presentDays, expected, breakdown } = quote;
    return {
      enabled: true,
      applicable: monthlyAmount > 0,
      mode,
      monthlyAmount,
      daysInMonth: range.daysInMonth,
      presentDays,
      mealCounts: counts,
      expected,
      breakdown,
    };
  }

  if (mode === "per_meal") {
    const breakdown = [];
    records.forEach((record) => {
      if (!MEALS.includes(record.meal)) return;
      const dated = settingsForDate(req.organization || {}, record.dateKey);
      const prices = dated.settings?.perMeal || settings.perMeal || {};
      const rate = Number(prices[record.meal] || 0);
      if (rate <= 0) return;
      const existing = breakdown.find((item) => item.label === record.meal && item.rate === rate);
      if (existing) {
        existing.count += 1;
        existing.amount += rate;
      } else {
        breakdown.push({ label: record.meal, count: 1, rate, amount: rate });
      }
    });
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
