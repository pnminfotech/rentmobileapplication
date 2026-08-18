// routes/adminNotificationRoutes.js
const express = require("express");
const router = express.Router();
const LeaveNotification = require("../models/LeaveNotification");
const authAdmin = require("../middleware/adminAuth");
const { scopedQuery } = require("../utils/organizationScope");

// List recent notifications (unread first because of sort by createdAt)
router.get("/notifications", authAdmin, async (req, res) => {
  const list = await LeaveNotification.find(scopedQuery(req))
    .sort({ createdAt: -1 })
    .limit(100)
    .lean();
  res.json(list);
});

// Mark as read
router.patch("/notifications/:id/read", authAdmin, async (req, res) => {
  const { id } = req.params;
  const doc = await LeaveNotification.findOneAndUpdate(
    scopedQuery(req, { _id: id }),
    { isRead: true },
    { new: true }
  );
  if (!doc) return res.status(404).json({ message: "Not found" });
  res.json(doc);
});

// Unread badge count
router.get("/notifications/unread-count", authAdmin, async (req, res) => {
  const count = await LeaveNotification.countDocuments(scopedQuery(req, { isRead: false }));
  res.json({ count });
});

module.exports = router;
