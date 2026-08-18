const Organization = require("../models/Organization");
const Room = require("../models/Room");
const Subscription = require("../models/Subscription");
const { isPastDate } = require("./subscriptionLifecycle");

function normalizeAllocation(units = {}) {
  return {
    beds: Math.max(0, Number(units.beds) || 0),
    rooms: Math.max(0, Number(units.rooms) || 0),
    shops: Math.max(0, Number(units.shops) || 0),
  };
}

async function getUnitUsage(organizationId) {
  const [bedResult, rooms, shops] = await Promise.all([
    Room.aggregate([
      { $match: { organizationId, propertyType: "bed" } },
      { $project: { count: { $size: { $ifNull: ["$beds", []] } } } },
      { $group: { _id: null, total: { $sum: "$count" } } },
    ]),
    Room.countDocuments({ organizationId, propertyType: "room" }),
    Room.countDocuments({ organizationId, propertyType: "shop" }),
  ]);

  return {
    beds: bedResult[0]?.total || 0,
    rooms,
    shops,
  };
}

async function getUnitQuota(organizationId) {
  const [organization, subscription, usage] = await Promise.all([
    Organization.findById(organizationId).lean(),
    Subscription.findOne({ organizationId, status: "active" })
      .sort({ createdAt: -1 })
      .lean(),
    getUnitUsage(organizationId),
  ]);

  if (!organization) {
    const err = new Error("Organization not found");
    err.status = 404;
    throw err;
  }

  if (!subscription) {
    const err = new Error("Active subscription required");
    err.status = 402;
    throw err;
  }

  if (isPastDate(subscription.endDate)) {
    const err = new Error("Subscription expired");
    err.status = 402;
    throw err;
  }

  const limits = normalizeAllocation(
    subscription.units || organization.unitAllocation
  );
  const remaining = {
    beds: Math.max(0, limits.beds - usage.beds),
    rooms: Math.max(0, limits.rooms - usage.rooms),
    shops: Math.max(0, limits.shops - usage.shops),
  };

  return {
    limits,
    usage,
    remaining,
    subscriptionId: subscription._id,
  };
}

async function assertUnitCapacity(organizationId, requested = {}) {
  const quota = await getUnitQuota(organizationId);
  const increments = normalizeAllocation(requested);

  for (const key of ["beds", "rooms", "shops"]) {
    if (quota.usage[key] + increments[key] > quota.limits[key]) {
      const err = new Error(
        `${key.slice(0, -1)} limit exceeded. ${quota.remaining[key]} remaining.`
      );
      err.status = 403;
      err.code = "UNIT_LIMIT_EXCEEDED";
      err.details = {
        unitType: key,
        requested: increments[key],
        ...quota,
      };
      throw err;
    }
  }

  return quota;
}

module.exports = {
  assertUnitCapacity,
  getUnitQuota,
  getUnitUsage,
};
