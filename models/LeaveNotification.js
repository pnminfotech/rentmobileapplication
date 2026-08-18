const mongoose = require("mongoose");

const LeaveNotificationSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    kind: { type: String, enum: ["leave_request"], default: "leave_request" },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LeaveRequest",
      required: true,
      index: true,
    },
    tenant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },
    tenantName: { type: String, default: "" },
    leaveDate: { type: Date, required: true },
    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

LeaveNotificationSchema.index({ organizationId: 1, isRead: 1, createdAt: -1 });

module.exports =
  mongoose.models.LeaveNotification ||
  mongoose.model("LeaveNotification", LeaveNotificationSchema);
