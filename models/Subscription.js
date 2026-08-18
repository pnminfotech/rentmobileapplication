const mongoose = require("mongoose");

const subscriptionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "SubscriptionPlan" },
    status: {
      type: String,
      enum: ["pending_payment", "active", "expired", "cancelled"],
      default: "pending_payment",
      index: true,
    },
    startDate: { type: Date },
    endDate: { type: Date },
    durationMonths: { type: Number, required: true, min: 1 },
    units: {
      beds: { type: Number, default: 0, min: 0 },
      rooms: { type: Number, default: 0, min: 0 },
      shops: { type: Number, default: 0, min: 0 },
    },
    amount: { type: Number, required: true, min: 0 },
    pricing: {
      subtotal: { type: Number, default: 0, min: 0 },
      planDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
      planDiscountAmount: { type: Number, default: 0, min: 0 },
      referralCode: { type: String, trim: true, uppercase: true, default: "" },
      referralOwnerOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: "Organization", default: null },
      referralDiscountPercent: { type: Number, default: 0, min: 0, max: 100 },
      referralDiscountAmount: { type: Number, default: 0, min: 0 },
      referralRewardCoins: { type: Number, default: 0, min: 0 },
      referralRewardGranted: { type: Boolean, default: false },
      walletCoinsUsed: { type: Number, default: 0, min: 0 },
      walletDiscountAmount: { type: Number, default: 0, min: 0 },
      walletDebitGranted: { type: Boolean, default: false },
      payableAmount: { type: Number, default: 0, min: 0 },
    },
    currency: { type: String, default: "INR", trim: true, uppercase: true },
    latestTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BillingTransaction",
    },
  },
  { timestamps: true }
);

subscriptionSchema.index({ organizationId: 1, status: 1 });
subscriptionSchema.index({ endDate: 1 });

module.exports =
  mongoose.models.Subscription ||
  mongoose.model("Subscription", subscriptionSchema);
