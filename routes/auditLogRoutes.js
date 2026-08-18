const express = require("express");
const AuditLog = require("../models/AuditLog");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery } = require("../utils/organizationScope");

const router = express.Router();

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

router.get("/", async (req, res) => {
  try {
    const { entityType, entityId, limit = 100 } = req.query;
    const query = {};
    if (entityType) query.entityType = String(entityType);
    if (entityId) query.entityId = entityId;

    const logs = await AuditLog.find(scopedQuery(req, query))
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 100, 300));

    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: "Failed to load audit history", error: error.message });
  }
});

module.exports = router;
