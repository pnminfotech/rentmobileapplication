const Notification = require("../models/Notification");
const SystemUser = require("../models/SystemUser");
const Organization = require("../models/Organization");
const { hasSmtpConfig, sendBasicEmail } = require("./emailService");

function appName() {
  return process.env.APP_NAME || "Rent Management";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character]));
}

async function recipientEmails(notification) {
  if (notification.audience === "superadmin") {
    const admins = await SystemUser.find({ role: "superadmin", status: { $ne: "suspended" } })
      .select("email")
      .lean();
    const configured = String(process.env.SUPERADMIN_NOTIFICATION_EMAILS || process.env.SUPERADMIN_EMAIL || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    return [...new Set([...admins.map((admin) => admin.email), ...configured].filter(Boolean))];
  }

  if (notification.userId) {
    const user = await SystemUser.findById(notification.userId).select("email").lean();
    return user?.email ? [user.email] : [];
  }

  if (notification.organizationId) {
    const [users, organization] = await Promise.all([
      SystemUser.find({
        organizationId: notification.organizationId,
        role: "system_admin",
        status: { $ne: "suspended" },
      }).select("email").lean(),
      Organization.findById(notification.organizationId).select("email").lean(),
    ]);
    return [...new Set([...users.map((user) => user.email), organization?.email].filter(Boolean))];
  }

  return [];
}

async function sendNotificationEmail(notification) {
  if (!hasSmtpConfig()) return { sent: false, skipped: "SMTP_NOT_CONFIGURED" };

  const recipients = await recipientEmails(notification);
  if (!recipients.length) return { sent: false, skipped: "NO_RECIPIENTS" };

  const title = notification.title || "Notification";
  const message = notification.message || "";
  const actionLine = notification.actionUrl ? `\n\nOpen: ${notification.actionUrl}` : "";
  await sendBasicEmail({
    to: recipients.join(","),
    subject: `${appName()}: ${title}`,
    text: `${title}\n\n${message}${actionLine}`,
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.5;color:#17202A">
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        ${notification.actionUrl ? `<p><a href="${escapeHtml(notification.actionUrl)}" style="display:inline-block;background:#2563EB;color:#fff;padding:10px 15px;border-radius:6px;text-decoration:none;font-weight:700">Open</a></p>` : ""}
      </div>
    `,
  });

  notification.emailSentAt = new Date();
  notification.emailError = "";
  await notification.save();
  return { sent: true, recipients };
}

async function createNotification(payload, options = {}) {
  const normalizedAudience = payload.audience || "organization";
  const normalizedOrganizationId = payload.organizationId || null;
  const normalizedUserId = payload.userId || null;
  const normalizedEntityType = payload.entityType || "system";
  const normalizedEntityId = payload.entityId || null;
  const normalizedActionType = payload.actionType || "";
  const normalizedType = payload.type || "system";

  const existing = await Notification.findOne({
    type: normalizedType,
    audience: normalizedAudience,
    organizationId: normalizedOrganizationId,
    userId: normalizedUserId,
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
    actionType: normalizedActionType,
    status: { $ne: "resolved" },
  }).sort({ createdAt: -1 });

  if (existing) {
    return existing;
  }

  const notification = await Notification.create({
    type: normalizedType,
    audience: normalizedAudience,
    organizationId: normalizedOrganizationId,
    userId: normalizedUserId,
    tenantId: payload.tenantId || null,
    tenantName: payload.tenantName || "",
    roomNo: payload.roomNo || "",
    bedNo: payload.bedNo || "",
    title: payload.title || "",
    message: payload.message || "",
    actionUrl: payload.actionUrl || "",
    priority: payload.priority || "normal",
    payload: payload.payload || {},
    status: payload.status || "unread",
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
    actionType: normalizedActionType,
    expiresAt: payload.expiresAt || null,
    read: payload.read ?? false,
  });

  if (options.email !== false) {
    try {
      await sendNotificationEmail(notification);
    } catch (err) {
      notification.emailError = err.code || err.message || "EMAIL_FAILED";
      await notification.save();
    }
  }

  return notification;
}

async function notifySuperadmins(payload, options) {
  return createNotification({ ...payload, audience: "superadmin", organizationId: null }, options);
}

async function notifyOrganization(organizationId, payload, options) {
  return createNotification({ ...payload, organizationId, audience: payload.audience || "organization" }, options);
}
async function resolveNotifications({
  organizationId,
  userId,
  audience,
  entityType,
  entityId,
  actionType,
}) {
  const query = {
    status: { $ne: "resolved" },
  };

  if (organizationId) query.organizationId = organizationId;
  if (userId) query.userId = userId;
  if (audience) query.audience = audience;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (actionType) query.actionType = actionType;

  return Notification.updateMany(query, {
    $set: {
      status: "resolved",
      resolvedAt: new Date(),
      read: true,
    },
  });
}
module.exports = {
  createNotification,
  notifyOrganization,
  notifySuperadmins,
  recipientEmails,
  sendNotificationEmail,
  resolveNotifications,
};
