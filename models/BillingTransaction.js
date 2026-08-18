const mongoose = require("mongoose");

const billingTransactionSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["phonepe", "manual"],
      default: "phonepe",
    },
    merchantTransactionId: { type: String, trim: true, unique: true, sparse: true },
    providerTransactionId: { type: String, trim: true, sparse: true },
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
    status: {
      type: String,
      enum: ["created", "pending", "success", "failed", "cancelled", "refunded"],
      default: "created",
      index: true,
    },
    requestPayload: { type: mongoose.Schema.Types.Mixed },
    responsePayload: { type: mongoose.Schema.Types.Mixed },
    callbackPayload: { type: mongoose.Schema.Types.Mixed },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

billingTransactionSchema.index({ organizationId: 1, createdAt: -1 });

module.exports =
  mongoose.models.BillingTransaction ||
  mongoose.model("BillingTransaction", billingTransactionSchema);
