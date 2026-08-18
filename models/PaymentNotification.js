const mongoose = require("mongoose");
const { Schema } = mongoose;

const PaymentNotificationSchema = new Schema({
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  tenantId: { type: Schema.Types.ObjectId, ref: "Form", required: true },
  paymentId:{ type: Schema.Types.ObjectId, ref: "Payment", required: true },
  amount:   { type: Number, required: true },
  month:    { type: Number },  // 1..12
  year:     { type: Number },
  utr:      { type: String },
  note:     { type: String },
  status:   { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  read:     { type: Boolean, default: false },
}, { timestamps: true });

PaymentNotificationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
PaymentNotificationSchema.index({ organizationId: 1, read: 1 });

module.exports = mongoose.model("PaymentNotification", PaymentNotificationSchema);
