const Organization = require("../models/Organization");
const Subscription = require("../models/Subscription");
const Notification = require("../models/Notification");
const { notifyOrganization, notifySuperadmins } = require("./notificationService");

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

function daysUntil(dateValue, now = new Date()) {
  const date = startOfDay(dateValue);
  const today = startOfDay(now);
  return Math.ceil((date - today) / (24 * 60 * 60 * 1000));
}

async function alreadySent({ organizationId, subscriptionId, type, reminderKey }) {
  return Notification.exists({
    organizationId,
    type,
    "payload.subscriptionId": String(subscriptionId),
    "payload.reminderKey": reminderKey,
  });
}

async function sendSubscriptionExpiryReminders(options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const reminderDays = Array.isArray(options.reminderDays) && options.reminderDays.length
    ? options.reminderDays
    : [30, 15, 7, 3, 1, 0];
  const maxDay = Math.max(...reminderDays);
  const from = startOfDay(now);
  const to = addDays(from, maxDay + 1);

  const subscriptions = await Subscription.find({
    status: "active",
    endDate: { $gte: from, $lt: to },
  }).lean();

  const results = [];
  for (const subscription of subscriptions) {
    const remainingDays = daysUntil(subscription.endDate, now);
    if (!reminderDays.includes(remainingDays)) continue;

    const organization = await Organization.findById(subscription.organizationId).lean();
    if (!organization || organization.status === "suspended") continue;

    const reminderKey = `${remainingDays}d`;
    if (await alreadySent({
      organizationId: organization._id,
      subscriptionId: subscription._id,
      type: "subscription_expiry",
      reminderKey,
    })) {
      continue;
    }

    const endDate = new Date(subscription.endDate).toLocaleDateString("en-IN");
    const label = remainingDays === 0 ? "today" : `in ${remainingDays} day${remainingDays === 1 ? "" : "s"}`;
    await Promise.allSettled([
      notifyOrganization(organization._id, {
        type: "subscription_expiry",
        title: "Subscription expiring soon",
        message: `Your subscription for ${organization.name} expires ${label} (${endDate}). Please renew to avoid service interruption.`,
        priority: remainingDays <= 3 ? "high" : "normal",
        entityType: "subscription",
        entityId: subscription._id,
        actionType: "subscription_expiry",
        expiresAt: addDays(subscription.endDate, 15),
        payload: {
          organizationId: String(organization._id),
          subscriptionId: String(subscription._id),
          reminderKey,
          remainingDays,
          endDate: subscription.endDate,
        },
      }),
      notifySuperadmins({
        type: "subscription_expiry",
        title: "Organization subscription expiring",
        message: `${organization.name} expires ${label} (${endDate}).`,
        priority: remainingDays <= 3 ? "high" : "normal",
        entityType: "subscription",
        entityId: subscription._id,
        actionType: "subscription_expiry",
        expiresAt: addDays(subscription.endDate, 15),
        payload: {
          organizationId: String(organization._id),
          subscriptionId: String(subscription._id),
          reminderKey,
          remainingDays,
          endDate: subscription.endDate,
        },
      }),
    ]);
    results.push({ organizationId: String(organization._id), subscriptionId: String(subscription._id), remainingDays });
  }

  return { checked: subscriptions.length, sent: results.length, results };
}

function startSubscriptionReminderJob() {
  const disabled = String(process.env.DISABLE_SUBSCRIPTION_REMINDER_JOB || "false").toLowerCase() === "true";
  if (disabled) return null;

  const run = () => {
    sendSubscriptionExpiryReminders().catch((err) => {
      console.error("subscription reminder job error:", err);
    });
  };

  const delayMs = Math.max(0, Number(process.env.SUBSCRIPTION_REMINDER_START_DELAY_MS || 15000));
  setTimeout(run, delayMs);
  return setInterval(run, 24 * 60 * 60 * 1000);
}

module.exports = {
  sendSubscriptionExpiryReminders,
  startSubscriptionReminderJob,
};
