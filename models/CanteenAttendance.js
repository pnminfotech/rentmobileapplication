const mongoose = require("mongoose");

const canteenAttendanceSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },
    dateKey: {
      type: String,
      required: true,
      index: true,
    },
    meal: {
      type: String,
      enum: ["breakfast", "lunch", "dinner"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["present", "absent"],
      required: true,
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    markedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

canteenAttendanceSchema.index(
  { organizationId: 1, tenantId: 1, dateKey: 1, meal: 1 },
  { unique: true }
);
canteenAttendanceSchema.index({ organizationId: 1, dateKey: 1, meal: 1, status: 1 });

module.exports = mongoose.model("CanteenAttendance", canteenAttendanceSchema);
