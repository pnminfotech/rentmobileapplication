// models/Notification.js
const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  type: {
    type: String,
    enum: [
      "payment_report",
      "leave_request",
      "system",
      "subscription_expiry",
      "subscription_expired",
      "payment_confirmation",
      "renewal_request",
      "registration",
      "document",
    ],
    required: true,
  },
  audience: {
    type: String,
    enum: ["system_admin", "superadmin", "tenant", "organization", "user"],
    default: "organization",
    index: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "SystemUser",
    default: null,
    index: true,
  },
  title: { type: String, trim: true, default: "" },
  message: { type: String, trim: true, default: "" },
  actionUrl: { type: String, trim: true, default: "" },
  priority: {
    type: String,
    enum: ["low", "normal", "high"],
    default: "normal",
    index: true,
  },
  emailSentAt: { type: Date, default: null },
  emailError: { type: String, default: "" },

  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Form", default: null },
  tenantName: String,
  roomNo: String,
  bedNo: String,

  // payment fields (existing)
  amount: Number,
  month: Number,
  year: Number,
  utr: String,
  note: String,
  receiptUrl: String,

  // leave (existing)
  leaveDate: Date,

  // ✅ NEW: free-form payload for attendance/system messages
  payload: mongoose.Schema.Types.Mixed,   // { kind, whenISO, where:{lat,lng,accuracy}, reason, dateKey }

  // status: { type: String, enum: ["pending", "approved", "rejected", "sent"], default: "pending" },
  status:{
    type:String,
    enum:["unread","read","resolved"],
    default:"unread",
  },
  entityType:{
    type:String,
    enum:["subscription","tenant","payment","organization","document","system"],
    default:"system",




  },
  entityId:{
    type:mongoose.Schema.Types.ObjectId,
    default:null,
  },
  actionType:{
    type:String,
    default:"",
  },
  expiresAt:{
    type:Date,
    default:null,
  },
  resolvedAt:{
    type:Date,
    default:null,
  },
  
  
  read: { type: Boolean, default: false },
}, { timestamps: true });

notificationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, read: 1 });
notificationSchema.index({ audience: 1, read: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });
notificationSchema.index({ organizationId: 1, status: 1, entityType: 1, entityId: 1, actionType: 1 });
notificationSchema.index({ expiresAt: 1 });

module.exports = mongoose.model("Notification", notificationSchema);
