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

function billingMonthFilter(monthKey, range) {
  return {
    $or: [
      { billingMonth: monthKey },
      { billingMonth: { $exists: false }, date: { $gte: range.start, $lte: range.end } },
    ],
  };
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
  if (!settings.enabled || settings.mode === "none") return { type, settings: null };
  return { type, settings };
}

function unitLocationQuery(record = {}, propertyType) {
  const query = { propertyType: propertyType || tenantType(record) };
  if (record.roomId) {
    query.roomId = record.roomId;
    return query;
  }

  query.roomNo = record.roomNo || "";
  if (record.category) query.category = record.category;
  if (record.wingName) query.wingName = record.wingName;
  if (record.floorNo) query.floorNo = record.floorNo;
  return query;
}

async function activeTenantCount(req, tenant = {}, range, scope = "room") {
  const query = {
    propertyType: tenantType(tenant),
    intakeStatus: { $ne: "pending_tenant" },
  };
  if (scope === "room") Object.assign(query, unitLocationQuery(tenant));
  const tenants = await Form.find(scopedQuery(req, query)).lean();
  return Math.max(tenants.filter((item) => isActiveDuringMonth(item, range)).length, 1);
}

async function linkedBills(req, tenant = {}, type, range, mode = "", monthKey = "") {
  const query = {
    propertyType: type,
    billPayer: "tenant",
    isUnitLinked: true,
    ...billingMonthFilter(monthKey, range),
  };
  if (mode) query.billingMode = { $in: [mode, null, ""] };
  if (tenant.roomId) query.roomId = tenant.roomId;
  else query.roomNo = tenant.roomNo || "";
  return LightBillEntry.find(scopedQuery(req, query)).lean();
}

async function hostelRoomBills(req, tenant = {}, range, monthKey = "") {
  return LightBillEntry.find(scopedQuery(req, {
    ...unitLocationQuery(tenant, "bed"),
    billPayer: "tenant",
    billingMode: { $in: ["room_meter_rate", "room_meter_actual_bill", "room_meter_split", "included_extra_split", null, ""] },
    isUnitLinked: true,
    ...billingMonthFilter(monthKey, range),
  })).lean();
}

async function commonHostelBills(req, range, monthKey = "") {
  return LightBillEntry.find(scopedQuery(req, {
    propertyType: "bed",
    billPayer: "owner",
    billingMode: "common_meter_split",
    isUnitLinked: false,
    ...billingMonthFilter(monthKey, range),
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
  const includedUnits = Number(bill.includedUnits ?? settings.includedUnits ?? 0);
  const actualBillMode = bill.billingMode === "room_meter_actual_bill";
  const measuredUnits = Number.isFinite(consumedUnits) && consumedUnits >= 0
    ? consumedUnits
    : enteredUnits;

  if (
    !Number.isFinite(measuredUnits) ||
    measuredUnits < 0 ||
    (!actualBillMode && (!Number.isFinite(ratePerUnit) || ratePerUnit <= 0))
  ) {
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
  // For a room meter, tenants pay only for usage after the included limit.
  // The owner-entered bill amount remains a record of the actual bill, but it
  // must not change the extra-unit charge calculated from the configured rate.
  const recoverableAmount = actualBillMode
    ? (measuredUnits > 0 ? Math.max(amount * extraUnits / measuredUnits, 0) : 0)
    : Math.max(extraUnits * ratePerUnit, 0);

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

function isTenantChargeBill(bill = {}) {
  return bill.billingMode === "common_meter_split" || (bill.billPayer !== "owner"
    && bill.isUnitLinked !== false
    && !["owner_only", "record_only"].includes(bill.billingMode));
}

async function getLightBillCollectionSummary(req, bill = {}) {
  const monthKey = bill.billingMonth || (bill.date ? `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][new Date(bill.date).getMonth()]}-${String(new Date(bill.date).getFullYear()).slice(-2)}` : "");
  const range = monthDateRange(monthKey);
  const empty = { applicable: false, expected: 0, collected: 0, balance: 0, tenantCount: 0, paidTenantCount: 0 };
  if (!range || !isTenantChargeBill(bill)) return empty;

  const type = tenantType({ propertyType: bill.propertyType });
  const tenantQuery = {
    propertyType: type,
    intakeStatus: { $ne: "pending_tenant" },
  };
  if (bill.billingMode !== "common_meter_split" && bill.roomNo) {
    Object.assign(tenantQuery, unitLocationQuery(bill, type));
  }
  const tenants = (await Form.find(scopedQuery(req, tenantQuery)).lean())
    .filter((tenant) => isActiveDuringMonth(tenant, range));
  if (!tenants.length) return empty;

  const settings = req.organization?.lightBillSettings?.[type] || {};
  const roomMeterBill = ["room_meter_split", "room_meter_rate", "room_meter_actual_bill"].includes(bill.billingMode);
  const amountPerTenant = roomMeterBill
    ? Math.round(Number(meterBreakdownForBill(bill, settings).recoverableAmount || 0) / tenants.length)
    : Number(bill.amount || bill.salary || 0);
  const expectedPerTenant = bill.billingMode === "common_meter_split"
    ? Math.round(Number(bill.amount || bill.salary || 0) / tenants.length)
    : amountPerTenant;
  const expected = Math.max(expectedPerTenant, 0) * tenants.length;

  let collected = 0;
  let paidTenantCount = 0;
  tenants.forEach((tenant) => {
    const tenantPaid = (Array.isArray(tenant.rents) ? tenant.rents : [])
      .filter((rent) => rent.month === monthKey)
      .reduce((sum, rent) => sum + Number(rent.lightBillAmount || 0), 0);
    if (tenantPaid > 0) paidTenantCount += 1;
    collected += tenantPaid;
  });

  const cappedCollected = Math.min(Math.max(collected, 0), expected);
  return {
    applicable: expected > 0,
    expected,
    collected: cappedCollected,
    balance: Math.max(expected - cappedCollected, 0),
    tenantCount: tenants.length,
    paidTenantCount,
  };
}

function modeLabel(mode) {
  const labels = {
    owner_only: "Owner/admin paid",
    tenant_unit_manual: "Unit light bill",
    tenant_unit_meter: "Unit meter bill",
    fixed_monthly: "Fixed monthly light charge",
    room_meter_split: "Room meter split",
    room_meter_rate: "Room meter rate",
    room_meter_actual_bill: "Actual bill split",
    included_extra_split: "Included amount plus extra split",
    fixed_per_tenant: "Fixed light charge per tenant",
    common_meter_split: "Common hostel bill split",
    common_owner_bill: "Common hostel bill paid by owner",
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
  if (mode === "owner_only" || !settings.addToRentCollection) {
    return {
      enabled: true,
      applicable: false,
      mode,
      modeLabel: "Light bill included in rent",
      expected: 0,
      breakdown: [{ label: "Owner pays the light bill. No separate light bill will be added in rent collection.", amount: 0 }],
    };
  }

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
    const bills = await linkedBills(req, tenant, type, range, mode, monthKey);
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

  if (["room_meter_split", "room_meter_rate", "room_meter_actual_bill"].includes(mode)) {
    const bills = await hostelRoomBills(req, tenant, range, monthKey);
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
    const bills = await hostelRoomBills(req, tenant, range, monthKey);
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
    const bills = await commonHostelBills(req, range, monthKey);
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
  getLightBillCollectionSummary,
  splitCollectedAmount,
};
