const mongoose = require("mongoose");

const LeaveRequestSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    tenant: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true },
    tenantName: String,            // denormalized optional
    leaveDate: { type: Date, required: true },
    note: String,
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
  },
  { timestamps: true }
);

LeaveRequestSchema.index({ organizationId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.models.LeaveRequest || mongoose.model("LeaveRequest", LeaveRequestSchema, "leaverequests");
