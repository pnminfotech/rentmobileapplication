const Form = require("../../models/formModels");
const LightBillEntry = require("../../models/LightBillEntry");
const { scopedQuery } = require("../../utils/organizationScope");

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
  return { start, end };
}

function tenantType(tenant = {}) {
  if (tenant.propertyType === "room" || tenant.propertyType === "shop") return tenant.propertyType;
  return "bed";
}

function isActiveDuringMonth(tenant = {}, range) {
  if (!range) return false;
  if (tenant.intakeStatus === "pending_tenant") return false;
  const joiningDate = tenant.joiningDate ? new Date(tenant.joiningDate) : null;
  if (joiningDate && !Number.isNaN(joiningDate.getTime()) && joiningDate > range.end) return false;
  const leaveDate = tenant.leaveDate ? new Date(tenant.leaveDate) : null;
  if (leaveDate && !Number.isNaN(leaveDate.getTime()) && leaveDate < range.start) return false;
  return true;
}

function activeSettings(req, tenant = {}) {
  const type = tenantType(tenant);
  const settings = req.organization?.lightBillSettings?.[type] || {};
  if (!settings.enabled || !settings.addToRentCollection || settings.mode === "none") return { type, settings: null };
  return { type, settings };
}

async function activeTenantCount(req, tenant = {}, range, scope = "room") {
  const query = {
    propertyType: tenantType(tenant),
    intakeStatus: { $ne: "pending_tenant" },
  };
  if (scope === "room") query.roomNo = tenant.roomNo || "";
  const tenants = await Form.find(scopedQuery(req, query)).lean();
  return Math.max(tenants.filter((item) => isActiveDuringMonth(item, range)).length, 1);
}

async function linkedBills(req, tenant = {}, type, range, mode = "") {
  const query = {
    propertyType: type,
    billPayer: "tenant",
    isUnitLinked: true,
    date: { $gte: range.start, $lte: range.end },
  };
  if (mode) query.billingMode = { $in: [mode, null, ""] };
  if (tenant.roomId) query.roomId = tenant.roomId;
  else query.roomNo = tenant.roomNo || "";
  return LightBillEntry.find(scopedQuery(req, query)).lean();
}

async function hostelRoomBills(req, tenant = {}, range) {
  return LightBillEntry.find(scopedQuery(req, {
    propertyType: "bed",
    billPayer: "tenant",
    billingMode: { $in: ["room_meter_split", null, ""] },
    isUnitLinked: true,
    roomNo: tenant.roomNo || "",
    date: { $gte: range.start, $lte: range.end },
  })).lean();
}

async function commonHostelBills(req, range) {
  return LightBillEntry.find(scopedQuery(req, {
    propertyType: "bed",
    billPayer: "owner",
    billingMode: "common_meter_split",
    isUnitLinked: false,
    date: { $gte: range.start, $lte: range.end },
  })).lean();
}

function billTotal(bills = []) {
  return bills.reduce((sum, bill) => sum + Number(bill.amount || bill.salary || 0), 0);
}

function meterBreakdownForBill(bill = {}, settings = {}) {
  const amount = Number(bill.amount || bill.salary || 0);
  const consumedUnits = Number(bill.consumedUnits);
  const enteredUnits = Number(bill.totalReading);
  const ratePerUnit = Number(bill.ratePerUnit ?? settings.ratePerUnit ?? 0);
  const fixedCharge = Number(bill.fixedCharge ?? settings.fixedCharge ?? 0);
  const includedUnits = Number(settings.includedUnits || 0);
  const measuredUnits = Number.isFinite(consumedUnits) && consumedUnits >= 0
    ? consumedUnits
    : enteredUnits;

  if (!Number.isFinite(measuredUnits) || measuredUnits < 0 || !Number.isFinite(ratePerUnit) || ratePerUnit <= 0) {
    return {
      recoverableAmount: amount,
      measuredUnits: null,
      consumedUnits: Number.isFinite(consumedUnits) && consumedUnits >= 0 ? consumedUnits : null,
      includedUnits,
      extraUnits: null,
      amount,
      usedFallback: true,
    };
  }

  const extraUnits = Math.max(measuredUnits - includedUnits, 0);
  const includedValue = includedUnits * ratePerUnit;
  const recoverableAmount = Math.max(amount - includedValue, 0);

  return {
    recoverableAmount,
    measuredUnits,
    consumedUnits,
    includedUnits,
    extraUnits,
    includedValue,
    amount,
    usedFallback: false,
  };
}

function modeLabel(mode) {
  const labels = {
    owner_only: "Owner/admin paid",
    tenant_unit_manual: "Unit light bill",
    tenant_unit_meter: "Unit meter bill",
    fixed_monthly: "Fixed monthly light charge",
    room_meter_split: "Room meter split",
    included_extra_split: "Included amount plus extra split",
    fixed_per_tenant: "Fixed light charge per tenant",
    common_meter_split: "Common hostel bill split",
  };
  return labels[mode] || "Light bill";
}

async function getLightBillQuoteForMonth(req, tenant = {}, monthKey = "") {
  const range = monthDateRange(monthKey);
  const empty = { enabled: Boolean(req.organization?.lightBillSettings?.isConfigured), applicable: false, mode: "", expected: 0, paid: 0, balance: 0, breakdown: [] };
  if (!range) return empty;

  const { type, settings } = activeSettings(req, tenant);
  if (!settings) return empty;

  const mode = settings.mode;
  if (mode === "fixed_monthly" || mode === "fixed_per_tenant") {
    const expected = Number(settings.fixedAmount || 0);
    return {
      enabled: true,
      applicable: expected > 0,
      mode,
      modeLabel: modeLabel(mode),
      expected,
      breakdown: [{ label: mode === "fixed_per_tenant" ? "Fixed light charge per tenant" : "Fixed monthly light charge", amount: expected }],
    };
  }

  if (["tenant_unit_manual", "tenant_unit_meter"].includes(mode)) {
    const bills = await linkedBills(req, tenant, type, range, mode);
    const expected = billTotal(bills);
    return {
      enabled: true,
      applicable: expected > 0,
      mode,
      modeLabel: modeLabel(mode),
      expected,
      bills: bills.map((bill) => ({ id: bill._id, name: bill.name, amount: Number(bill.amount || 0), status: bill.status, date: bill.date })),
      breakdown: bills.map((bill) => ({ label: bill.name || "Light bill", amount: Number(bill.amount || 0), status: bill.status })),
    };
  }

  if (mode === "room_meter_split") {
    const bills = await hostelRoomBills(req, tenant, range);
    const members = await activeTenantCount(req, tenant, range, "room");
    const includedUnits = Number(settings.includedUnits || 0);
    const billParts = bills.map((bill) => meterBreakdownForBill(bill, settings));
    const recoverableTotal = billParts.reduce((sum, part) => sum + Number(part.recoverableAmount || 0), 0);
    const expected = Math.round(recoverableTotal / members);
    return {
      enabled: true,
      applicable: expected > 0,
      mode,
      modeLabel: modeLabel(mode),
      expected,
      members,
      roomBillAmount: billTotal(bills),
      includedUnits,
      recoverableAmount: recoverableTotal,
      breakdown: [
        {
          label: includedUnits > 0
            ? `Extra light bill after ${includedUnits} included unit${includedUnits === 1 ? "" : "s"}`
            : `Room meter split (${members} tenant${members === 1 ? "" : "s"})`,
          amount: expected,
          total: recoverableTotal,
        },
        ...billParts
          .filter((part) => Number(part.recoverableAmount || 0) > 0 || part.usedFallback)
          .map((part, index) => ({
            label: part.usedFallback
              ? `Meter bill ${index + 1}`
              : `${Math.max(part.extraUnits, 0)} unit${part.extraUnits === 1 ? "" : "s"} above included limit`,
            amount: Math.round(Number(part.recoverableAmount || 0)),
            total: part.amount,
          })),
      ],
    };
  }

  if (mode === "included_extra_split") {
    const bills = await hostelRoomBills(req, tenant, range);
    const total = billTotal(bills);
    const members = await activeTenantCount(req, tenant, range, "room");
    const includedAmount = Number(settings.includedAmount || 0);
    const includedTotal = includedAmount * members;
    const extraPerTenant = Math.max(total - includedTotal, 0) / members;
    const expected = Math.round(includedAmount + extraPerTenant);
    return {
      enabled: true,
      applicable: expected > 0,
      mode,
      modeLabel: modeLabel(mode),
      expected,
      members,
      roomBillAmount: total,
      includedAmount,
      breakdown: [{ label: "Included light amount", amount: includedAmount }, { label: `Extra split (${members} tenants)`, amount: Math.round(extraPerTenant), total }],
    };
  }

  if (mode === "common_meter_split") {
    const bills = await commonHostelBills(req, range);
    const total = billTotal(bills);
    const members = await activeTenantCount(req, tenant, range, "all");
    const expected = Math.round(total / members);
    return {
      enabled: true,
      applicable: expected > 0,
      mode,
      modeLabel: modeLabel(mode),
      expected,
      members,
      commonBillAmount: total,
      breakdown: [{ label: `Common hostel meter split (${members} tenants)`, amount: expected, total }],
    };
  }

  return empty;
}

function splitCollectedAmount(totalAmount, rentBalance, canteenBalance, lightBillBalance) {
  const total = Math.max(Number(totalAmount || 0), 0);
  const rentPart = Math.min(total, Math.max(Number(rentBalance || 0), 0));
  const canteenPart = Math.min(Math.max(total - rentPart, 0), Math.max(Number(canteenBalance || 0), 0));
  const lightBillPart = Math.min(Math.max(total - rentPart - canteenPart, 0), Math.max(Number(lightBillBalance || 0), 0));
  const extraPart = Math.max(total - rentPart - canteenPart - lightBillPart, 0);
  return { rentPart, canteenPart, lightBillPart, extraPart };
}

module.exports = {
  getLightBillQuoteForMonth,
  splitCollectedAmount,
};
