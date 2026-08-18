const mongoose = require("mongoose");

const unitPricingSchema = new mongoose.Schema(
  {
    bedMonthly: { type: Number, default: 0, min: 0 },
    roomMonthly: { type: Number, default: 0, min: 0 },
    shopMonthly: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, trim: true, lowercase: true, unique: true },
    durationMonths: { type: Number, required: true, min: 1 },
    unitPricing: { type: unitPricingSchema, default: () => ({}) },
    baseAmount: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    currency: { type: String, default: "INR", trim: true, uppercase: true },
    isActive: { type: Boolean, default: true, index: true },
    description: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.SubscriptionPlan ||
  mongoose.model("SubscriptionPlan", subscriptionPlanSchema);
