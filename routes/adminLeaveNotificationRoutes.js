const express = require("express");
const router = express.Router();
const LeaveNotification = require("../models/LeaveNotification");
const LeaveRequest = require("../models/LeaveRequest");
const requireAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { scopedQuery } = require("../utils/organizationScope");

router.use(attachSystemAuthIfPresent);

router.get("/notifications/leave", requireAdmin, async (req,res)=>{
  const limit = Math.min(parseInt(req.query.limit||"100",10), 200);
  const unread = String(req.query.unread||"false")==="true";
  const list = await LeaveNotification.find(scopedQuery(req, unread ? { isRead: false } : {}))
    .sort({createdAt:-1})
    .limit(limit)
    .populate({ path:"requestId", model:"LeaveRequest" })
    .populate({ path:"tenant", model:"Tenant", select:"name roomNo bedNo" })
    .lean();
  res.json(list);
});

router.get("/notifications/leave/unread-count", requireAdmin, async (req,res)=>{
  const count = await LeaveNotification.countDocuments(scopedQuery(req, { isRead:false }));
  res.json({ count });
});

router.patch("/notifications/leave/:id/read", requireAdmin, async (req,res)=>{
  const { id } = req.params;
  const doc = await LeaveNotification.findOneAndUpdate(scopedQuery(req, { _id: id }), { isRead:true }, { new:true });
  if(!doc) return res.status(404).json({ message:"Not found" });
  res.json(doc);
});

router.post("/notifications/leave/read-all", requireAdmin, async (req,res)=>{
  await LeaveNotification.updateMany(scopedQuery(req, { isRead:false }), { $set:{ isRead:true }});
  res.json({ ok:true });
});

router.post("/leave/:id/approve", requireAdmin, async (req,res)=>{
  const { id } = req.params;
  const doc = await LeaveRequest.findOne(scopedQuery(req, { _id: id }));
  if(!doc) return res.status(404).json({ message:"Request not found" });
  if(doc.status !== "pending") return res.status(400).json({ message:"Only pending can be updated" });
  doc.status = "approved";
  await doc.save();
  res.json(doc);
});

router.post("/leave/:id/reject", requireAdmin, async (req,res)=>{
  const { id } = req.params;
  const { reason = "" } = req.body;
  const doc = await LeaveRequest.findOne(scopedQuery(req, { _id: id }));
  if(!doc) return res.status(404).json({ message:"Request not found" });
  if(doc.status !== "pending") return res.status(400).json({ message:"Only pending can be updated" });
  doc.status = "rejected";
  doc.cancelReason = reason;
  await doc.save();
  res.json(doc);
});

module.exports = router;
