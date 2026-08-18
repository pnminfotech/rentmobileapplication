const mongoose = require("mongoose");

const unitAllocationSchema = new mongoose.Schema(
  {
    beds: { type: Number, default: 0, min: 0 },
    rooms: { type: Number, default: 0, min: 0 },
    shops: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const featureSchema = new mongoose.Schema(
  {
    canteenEnabled: { type: Boolean, default: false },
  },
  { _id: false }
);

const mealPriceSchema = new mongoose.Schema(
  {
    breakfast: { type: Number, default: 0, min: 0 },
    lunch: { type: Number, default: 0, min: 0 },
    dinner: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const canteenSettingsSchema = new mongoose.Schema(
  {
    isConfigured: { type: Boolean, default: false },
    activeModes: {
      type: [String],
      enum: ["full_package", "per_meal", "meal_package", "guest_meal"],
      default: [],
    },
    fullPackage: {
      monthlyAmount: { type: Number, default: 0, min: 0 },
      includedMeals: {
        type: [String],
        enum: ["breakfast", "lunch", "dinner"],
        default: ["breakfast", "lunch", "dinner"],
      },
    },
    perMeal: { type: mealPriceSchema, default: () => ({}) },
    mealPackage: {
      name: { type: String, trim: true, default: "Meal package" },
      monthlyAmount: { type: Number, default: 0, min: 0 },
      includedMeals: {
        type: [String],
        enum: ["breakfast", "lunch", "dinner"],
        default: ["lunch", "dinner"],
      },
    },
    guestMeal: { type: mealPriceSchema, default: () => ({}) },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const lightBillPropertySettingsSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: false },
    mode: {
      type: String,
      enum: [
        "none",
        "owner_only",
        "tenant_unit_manual",
        "tenant_unit_meter",
        "tenant_direct",
        "fixed_monthly",
        "room_meter_split",
        "fixed_per_tenant",
        "included_extra_split",
        "common_meter_split",
        "record_only",
      ],
      default: "none",
    },
    addToRentCollection: { type: Boolean, default: false },
    fixedAmount: { type: Number, default: 0, min: 0 },
    includedAmount: { type: Number, default: 0, min: 0 },
    includedUnits: { type: Number, default: 0, min: 0 },
    ratePerUnit: { type: Number, default: 0, min: 0 },
    fixedCharge: { type: Number, default: 0, min: 0 },
    splitMethod: {
      type: String,
      enum: ["equal_active_tenants", "manual", "by_room", "by_bed"],
      default: "equal_active_tenants",
    },
    notes: { type: String, trim: true, default: "" },
  },
  { _id: false }
);

const lightBillSettingsSchema = new mongoose.Schema(
  {
    isConfigured: { type: Boolean, default: false },
    bed: { type: lightBillPropertySettingsSchema, default: () => ({}) },
    room: { type: lightBillPropertySettingsSchema, default: () => ({}) },
    shop: { type: lightBillPropertySettingsSchema, default: () => ({}) },
    updatedAt: { type: Date },
  },
  { _id: false }
);

const organizationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    businessType: {
      type: String,
      enum: ["hostel", "rooms", "shops", "mixed"],
      default: "mixed",
    },
    ownerName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
    unitAllocation: { type: unitAllocationSchema, default: () => ({}) },
    features: { type: featureSchema, default: () => ({}) },
    canteenSettings: { type: canteenSettingsSchema, default: () => ({}) },
    lightBillSettings: { type: lightBillSettingsSchema, default: () => ({}) },
    status: {
      type: String,
      enum: ["pending_payment", "active", "suspended", "expired", "cancelled"],
      default: "pending_payment",
      index: true,
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "SystemUser" },
    activatedAt: { type: Date },
    suspendedAt: { type: Date },
    notes: { type: String, default: "" },
  },
  { timestamps: true }
);

organizationSchema.index({ email: 1 });
organizationSchema.index({ status: 1, createdAt: -1 });

module.exports =
  mongoose.models.Organization ||
  mongoose.model("Organization", organizationSchema);
