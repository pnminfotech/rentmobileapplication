// payment-Backend/middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const User = require('../models/userModel'); // you already have this model
const SystemUser = require('../models/SystemUser');
const Organization = require('../models/Organization');

function getSaasJwtSecret() {
  return (
    process.env.SAAS_JWT_SECRET ||
    process.env.JWT_SECRET ||
    process.env.JWT_TOKEN ||
    'dev_saas_secret'
  );
}

function getLegacyJwtSecrets() {
  return [
    process.env.JWT_SECRET,
    process.env.JWT_TOKEN,
    'your-secret-key',
    'dev_secret',
  ].filter(Boolean);
}

function verifyLegacyToken(token) {
  let lastError = null;
  for (const secret of getLegacyJwtSecrets()) {
    try {
      return jwt.verify(token, secret);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Invalid token');
}

async function trySystemAdminAuth(token, req, res, next) {
  try {
    const payload = jwt.verify(token, getSaasJwtSecret());
    if (payload.tokenType !== 'system') return false;

    const user = await SystemUser.findById(payload.sub);
    if (!user) {
      res.status(401).json({ message: 'User not found' });
      return true;
    }
    if (user.status === 'suspended') {
      res.status(403).json({ message: 'Account suspended' });
      return true;
    }
    if (user.role !== 'system_admin') {
      res.status(403).json({ message: 'System admin access required' });
      return true;
    }
    if (!user.organizationId) {
      res.status(403).json({ message: 'Organization required' });
      return true;
    }

    const organization = await Organization.findById(user.organizationId);
    if (!organization) {
      res.status(403).json({ message: 'Organization not found' });
      return true;
    }
    if (organization.status !== 'active') {
      res.status(402).json({
        message: 'Subscription payment required',
        organizationStatus: organization.status,
      });
      return true;
    }

    req.systemUser = user;
    req.organization = organization;
    req.organizationId = organization._id;
    req.admin = {
      id: user._id,
      _id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
    };
    next();
    return true;
  } catch (_err) {
    return false;
  }
}

module.exports = async function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const handledBySystemAuth = await trySystemAdminAuth(token, req, res, next);
    if (handledBySystemAuth) return;

    const payload = verifyLegacyToken(token);

    // Adjust this if your token stores a different key
    const userId = payload.id || payload._id || payload.userId;
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ message: 'User not found' });

    // Accept either a boolean flag or a role field
    const isAdmin = user.isAdmin === true || user.role === 'admin';
    if (!isAdmin) return res.status(403).json({ message: 'Admin access required' });

    req.admin = user; // attach for downstream handlers
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid/expired token' });
  }
};
