const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    entityType: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    action: {
      type: String,
      enum: ["create", "update", "delete"],
      required: true,
      index: true,
    },
    actorId: { type: String, default: "" },
    actorName: { type: String, default: "Admin" },
    actorEmail: { type: String, default: "" },
    actorRole: { type: String, default: "" },
    reason: { type: String, default: "" },
    changes: { type: mongoose.Schema.Types.Mixed, default: {} },
    before: { type: mongoose.Schema.Types.Mixed, default: null },
    after: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: true }
);

auditLogSchema.index({ organizationId: 1, entityType: 1, entityId: 1, createdAt: -1 });
auditLogSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
