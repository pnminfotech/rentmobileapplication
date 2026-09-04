const mongoose = require("mongoose");

// const LightBillEntrySchema = new mongoose.Schema({
//   roomNo: { type: String, required: true },
//   meterNo: { type: String, required: true },
//   totalReading: { type: Number, required: true },
//   amount: { type: Number, required: true },
//    status: {
//     type: String,
//     enum: ['paid', 'pending'],
//     default: 'pending'
//   },
//   date: { type: Date, required: true },
// });

// module.exports = mongoose.model("LightBillEntry", LightBillEntrySchema);


const LightBillEntrySchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  name: { type: String, required: true }, // e.g., "Meter 101" or "Maushi"
  type: { type: String, enum: ['meter', 'maushi', 'custom'], required: true },
  billPayer: {
    type: String,
    enum: ["tenant", "owner"],
    default: "tenant",
    index: true,
  },
  billingMode: {
    type: String,
    enum: [
      "owner_only",
      "tenant_unit_manual",
      "tenant_unit_meter",
      "fixed_monthly",
      "room_meter_split",
      "room_meter_rate",
      "room_meter_actual_bill",
      "included_extra_split",
      "fixed_per_tenant",
      "common_owner_bill",
      "common_meter_split",
    ],
    default: "tenant_unit_manual",
    index: true,
  },
  isUnitLinked: { type: Boolean, default: true, index: true },
  roomId: { type: mongoose.Schema.Types.ObjectId, ref: "Room", default: null },
  propertyType: {
    type: String,
    enum: ["bed", "room", "shop"],
    default: "bed",
  },
  category: { type: String, default: "" },
  wingName: { type: String, default: "" },
  floorNo: { type: String, default: "" },
  roomNo: { type: String },
  meterNo: { type: String },
  previousReading: { type: Number },
  totalReading: { type: Number },
  consumedUnits: { type: Number },
  includedUnits: { type: Number },
  ratePerUnit: { type: Number },
  fixedCharge: { type: Number },
  amount: { type: Number },
  salary: { type: Number },
  customLabel: { type: String },
  status: { type: String, enum: ['paid', 'pending'], default: 'pending' },
  billingMonth: { type: String, trim: true, index: true },
  date: { type: Date, required: true },
  createdByName: { type: String, default: "" },
  updatedByName: { type: String, default: "" },
}, { timestamps: true });

LightBillEntrySchema.index({ organizationId: 1, date: -1 });
LightBillEntrySchema.index({ organizationId: 1, name: 1, propertyType: 1, roomNo: 1, date: 1 });
LightBillEntrySchema.index({ organizationId: 1, billPayer: 1, date: -1 });
LightBillEntrySchema.index({ organizationId: 1, billingMode: 1, propertyType: 1, date: -1 });
LightBillEntrySchema.index({ organizationId: 1, billingMonth: 1, propertyType: 1, roomNo: 1 });

module.exports = mongoose.model("LightBillEntry", LightBillEntrySchema);
