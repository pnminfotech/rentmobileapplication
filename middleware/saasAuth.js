const jwt = require("jsonwebtoken");
const SystemUser = require("../models/SystemUser");
const Organization = require("../models/Organization");
const {
  getLatestSubscription,
  isSubscriptionUsable,
  refreshSubscriptionStateForOrganization,
} = require("../services/subscriptionLifecycle");

const TOKEN_EXPIRES_IN = process.env.SAAS_JWT_EXPIRES_IN || "30d";

function getJwtSecret() {
  return (
    process.env.SAAS_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.JWT_TOKEN ||
    "dev_saas_secret"
  );
}

function signSystemToken(user) {
  return jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      organizationId: user.organizationId ? String(user.organizationId) : null,
      tokenType: "system",
    },
    getJwtSecret(),
    { expiresIn: TOKEN_EXPIRES_IN }
  );
}

function readBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1] : null;
}

async function requireSystemAuth(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return res.status(401).json({ message: "Missing auth token" });

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== "system") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await SystemUser.findById(payload.sub).select("+password");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }

    let organization = null;
    if (user.organizationId) {
      organization = await Organization.findById(user.organizationId);
      if (!organization) {
        return res.status(403).json({ message: "Organization not found" });
      }
      const lifecycle = await refreshSubscriptionStateForOrganization(organization);
      organization = lifecycle.organization;
      if (organization.status === "suspended") {
        return res.status(403).json({ message: "Organization suspended" });
      }
    }

    req.systemUser = user;
    req.organization = organization;
    req.organizationId = organization ? organization._id : null;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

async function attachSystemAuthIfPresent(req, res, next) {
  try {
    const token = readBearerToken(req);
    if (!token) return next();

    const payload = jwt.verify(token, getJwtSecret());
    if (payload.tokenType !== "system") {
      return res.status(401).json({ message: "Invalid token type" });
    }

    const user = await SystemUser.findById(payload.sub).select("+password");
    if (!user) return res.status(401).json({ message: "User not found" });
    if (user.status === "suspended") {
      return res.status(403).json({ message: "Account suspended" });
    }

    let organization = null;
    if (user.organizationId) {
      organization = await Organization.findById(user.organizationId);
      if (!organization) {
        return res.status(403).json({ message: "Organization not found" });
      }
      const lifecycle = await refreshSubscriptionStateForOrganization(organization);
      organization = lifecycle.organization;
      if (organization.status === "suspended") {
        return res.status(403).json({ message: "Organization suspended" });
      }
      if (organization.status === "expired") {
        return res.status(402).json({
          message: "Subscription expired",
          organizationStatus: organization.status,
          subscriptionStatus: lifecycle.subscription?.status || "expired",
          subscriptionEndDate: lifecycle.subscription?.endDate || null,
        });
      }
    }

    req.systemUser = user;
    req.organization = organization;
    req.organizationId = organization ? organization._id : null;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return function roleGuard(req, res, next) {
    if (!req.systemUser) {
      return res.status(401).json({ message: "Authentication required" });
    }
    if (!allowedRoles.includes(req.systemUser.role)) {
      return res.status(403).json({ message: "Access denied" });
    }
    next();
  };
}

async function requireActiveOrganization(req, res, next) {
  try {
    if (req.systemUser?.role === "superadmin") return next();
    if (!req.organization) {
      return res.status(403).json({ message: "Organization required" });
    }

    const subscription = await getLatestSubscription(req.organization._id);
    if (!isSubscriptionUsable(req.organization, subscription)) {
      return res.status(402).json({
        message: req.organization.status === "expired" || subscription?.status === "expired"
          ? "Subscription expired"
          : "Subscription payment required",
        organizationStatus: req.organization.status,
        subscriptionStatus: subscription?.status || null,
        subscriptionEndDate: subscription?.endDate || null,
      });
    }
    next();
  } catch (err) {
    return res.status(500).json({ message: "Unable to verify subscription status" });
  }
}

module.exports = {
  getJwtSecret,
  signSystemToken,
  requireSystemAuth,
  attachSystemAuthIfPresent,
  requireRole,
  requireActiveOrganization,
};
