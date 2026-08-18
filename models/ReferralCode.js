const mongoose = require("mongoose");

const referralCodeSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true },
    title: { type: String, required: true, trim: true },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    rewardCoins: { type: Number, default: 100, min: 0 },
    earnedCoins: { type: Number, default: 0, min: 0 },
    ownerOrganizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    source: {
      type: String,
      enum: ["auto_system_admin", "manual"],
      default: "auto_system_admin",
      index: true,
    },
    maxUses: { type: Number, default: 0, min: 0 },
    usedCount: { type: Number, default: 0, min: 0 },
    validFrom: { type: Date },
    validUntil: { type: Date },
    isActive: { type: Boolean, default: true, index: true },
    notes: { type: String, trim: true, default: "" },
  },
  { timestamps: true }
);

referralCodeSchema.index({ isActive: 1, validUntil: 1 });

module.exports =
  mongoose.models.ReferralCode ||
  mongoose.model("ReferralCode", referralCodeSchema);
