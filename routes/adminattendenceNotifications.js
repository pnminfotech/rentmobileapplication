const router = require("express").Router();

const Notification = require("../models/Notification");
const authAdmin = require("../middleware/adminAuth");
const { scopedQuery } = require("../utils/organizationScope");

router.get("/notifications/attendance", authAdmin, async (req, res, next) => {
  try {
    const docs = await Notification.find(
      scopedQuery(req, {
        type: "system",
        "payload.kind": { $regex: "^attendance_" },
      })
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .populate("tenantId", "name roomNo bedNo");

    res.json(docs);
  } catch (err) {
    next(err);
  }
});

router.post("/notifications/:id/seen", authAdmin, async (req, res, next) => {
  try {
    const doc = await Notification.findOneAndUpdate(
      scopedQuery(req, { _id: req.params.id }),
      { $set: { read: true } },
      { new: true }
    );
    if (!doc) return res.status(404).json({ message: "Notification not found" });

    res.json({ ok: true, updated: doc });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
