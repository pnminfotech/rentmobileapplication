const Form = require("../models/formModels");
const Room = require("../models/Room");
const Organization = require("../models/Organization");
const Notification = require("../models/Notification");
const { getUnpaidRentBeforeDate } = require("../routes/_helpers/rentHistory");
const { sendRentReminderSms } = require("./smsService");

function startOfDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(value = new Date()) {
  const date = new Date(value);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function formatDate(value = new Date()) {
  return new Date(value).toLocaleDateString("en-IN");
}

function sameDateKey(a, b) {
  return dateKey(a) === dateKey(b);
}

function reminderDueDate(tenant, dueMonth) {
  const isAdvance = String(tenant.firstRentStatus || "").trim() === "ADVANCE_PAID";
  return isAdvance ? dueMonth.cycleStart : dueMonth.cycleEnd;
}

function activeTenantQuery(organizationId) {
  const today = dateKey();
  const endOfToday = startOfDay();
  endOfToday.setHours(23, 59, 59, 999);

  return {
    ...(organizationId ? { organizationId } : {}),
    phoneNo: { $exists: true, $ne: "" },
    intakeStatus: { $ne: "pending_tenant" },
    $or: [
      { leaveDate: { $exists: false } },
      { leaveDate: null },
      { leaveDate: "" },
      { leaveDate: { $type: "string", $gt: today } },
      { leaveDate: { $type: "date", $gt: endOfToday } },
    ],
  };
}

async function alreadySentToday(tenant, reminderKey) {
  return Notification.exists({
    organizationId: tenant.organizationId || null,
    tenantId: tenant._id,
    type: "system",
    entityType: "tenant",
    actionType: "sms_rent_reminder",
    "payload.reminderKey": reminderKey,
  });
}

async function markReminderSent({ tenant, amountDue, billingMonth, reminderKey, result }) {
  return Notification.create({
    organizationId: tenant.organizationId || null,
    tenantId: tenant._id,
    tenantName: tenant.name || "",
    roomNo: tenant.roomNo || "",
    bedNo: tenant.bedNo || "",
    type: "system",
    audience: "tenant",
    title: "Rent reminder SMS sent",
    message: `Rent reminder SMS sent to ${tenant.name || "tenant"} for ${billingMonth}.`,
    status: "resolved",
    read: true,
    entityType: "tenant",
    entityId: tenant._id,
    actionType: "sms_rent_reminder",
    expiresAt: addDays(new Date(), 45),
    payload: {
      reminderKey,
      amountDue,
      billingMonth,
      sms: result,
    },
  });
}

async function sendRentReminderSmsJob(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const targetDueDate = startOfDay(options.dueDate || addDays(now, Number(process.env.RENT_SMS_REMINDER_DAYS_BEFORE || 2)));
  const reminderKeyBase = dateKey(targetDueDate);
  const organizationId = options.organizationId ? String(options.organizationId) : "";

  const [tenants, rooms] = await Promise.all([
    Form.find(activeTenantQuery(organizationId)).lean(),
    Room.find(organizationId ? { organizationId } : {}).lean(),
  ]);

  const organizations = new Map();
  const results = [];

  for (const tenant of tenants) {
    const dueMonths = getUnpaidRentBeforeDate(tenant, targetDueDate, rooms).filter((month) =>
      sameDateKey(reminderDueDate(tenant, month), targetDueDate)
    );
    if (!dueMonths.length) continue;
    const reminderKey = `${reminderKeyBase}:${dueMonths.map((month) => month.month).join(",")}`;
    if (await alreadySentToday(tenant, reminderKey)) continue;

    const amountDue = dueMonths.reduce((sum, item) => sum + Number(item.outstanding || 0), 0);
    if (amountDue <= 0) continue;

    const billingMonth =
      dueMonths.length === 1
        ? dueMonths[0].month
        : `${dueMonths[0].month} to ${dueMonths[dueMonths.length - 1].month}`;

    const organizationId = tenant.organizationId ? String(tenant.organizationId) : "";
    if (organizationId && !organizations.has(organizationId)) {
      organizations.set(organizationId, await Organization.findById(organizationId).lean());
    }

    const organization = organizationId ? organizations.get(organizationId) : null;
    const smsResult = await sendRentReminderSms({
      tenant,
      organization: organization || {},
      amountDue,
      billingMonth,
      dueDate: targetDueDate,
    });

    await markReminderSent({
      tenant,
      amountDue,
      billingMonth,
      reminderKey,
      result: smsResult,
    });

    results.push({
      tenantId: String(tenant._id),
      tenantName: tenant.name,
      amountDue,
      billingMonth,
      sms: smsResult,
    });
  }

  return { checked: tenants.length, sent: results.length, results };
}

function startRentReminderSmsJob() {
  const disabled = String(process.env.DISABLE_RENT_SMS_REMINDER_JOB || "false").toLowerCase() === "true";
  if (disabled) return null;

  const run = () => {
    sendRentReminderSmsJob().catch((err) => {
      console.error("rent SMS reminder job error:", err);
    });
  };

  const delayMs = Math.max(0, Number(process.env.RENT_SMS_REMINDER_START_DELAY_MS || 20000));
  setTimeout(run, delayMs);
  return setInterval(run, 24 * 60 * 60 * 1000);
}

module.exports = {
  sendRentReminderSmsJob,
  startRentReminderSmsJob,
};
