const Organization = require("../models/Organization");
const SystemUser = require("../models/SystemUser");
const Subscription = require("../models/Subscription");

function isPastDate(value, now = new Date()) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  date.setHours(23, 59, 59, 999);
  return date < now;
}

async function getLatestSubscription(organizationId) {
  if (!organizationId) return null;
  return Subscription.findOne({ organizationId }).sort({ createdAt: -1 });
}

async function refreshSubscriptionStateForOrganization(organization, options = {}) {
  if (!organization?._id) return { organization, subscription: null, expired: false };

  const now = options.now || new Date();
  const subscription = await getLatestSubscription(organization._id);
  const stillValid = subscription?.endDate && !isPastDate(subscription.endDate, now);

  if (stillValid && (subscription.status === "expired" || organization.status === "expired")) {
    if (subscription.status === "expired") {
      subscription.status = "active";
      await subscription.save();
    }

    if (organization.status === "expired") {
      organization.status = "active";
      await organization.save();
    }

    await SystemUser.updateMany(
      { organizationId: organization._id, status: "pending_payment" },
      { $set: { status: "active" } }
    );

    return { organization, subscription, expired: false };
  }

  const expired = subscription?.status === "active" && isPastDate(subscription.endDate, now);

  if (!expired) return { organization, subscription, expired: false };

  subscription.status = "expired";
  await subscription.save();

  if (!["suspended", "cancelled"].includes(organization.status)) {
    organization.status = "expired";
    await organization.save();
  }

  await SystemUser.updateMany(
    { organizationId: organization._id, status: "active" },
    { $set: { status: "pending_payment" } }
  );

  return { organization, subscription, expired: true };
}

async function expireDueSubscriptions(options = {}) {
  const now = options.now || new Date();
  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  const expiredSubscriptions = await Subscription.find({
    status: "active",
    endDate: { $lt: cutoff },
  });

  const organizationIds = expiredSubscriptions.map((subscription) => subscription.organizationId);
  if (!organizationIds.length) {
    return { expiredCount: 0, organizationIds: [] };
  }

  await Subscription.updateMany(
    { _id: { $in: expiredSubscriptions.map((subscription) => subscription._id) } },
    { $set: { status: "expired" } }
  );

  await Organization.updateMany(
    { _id: { $in: organizationIds }, status: { $nin: ["suspended", "cancelled"] } },
    { $set: { status: "expired" } }
  );

  await SystemUser.updateMany(
    { organizationId: { $in: organizationIds }, status: "active" },
    { $set: { status: "pending_payment" } }
  );

  return {
    expiredCount: expiredSubscriptions.length,
    organizationIds,
  };
}

function isSubscriptionUsable(organization, subscription) {
  return (
    organization?.status === "active" &&
    subscription?.status === "active" &&
    !isPastDate(subscription.endDate)
  );
}

module.exports = {
  getLatestSubscription,
  expireDueSubscriptions,
  isPastDate,
  isSubscriptionUsable,
  refreshSubscriptionStateForOrganization,
};
