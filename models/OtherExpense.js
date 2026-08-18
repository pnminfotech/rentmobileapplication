const mongoose = require('mongoose');

const otherExpenseSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  roomNo: { type: String, default: "" },
  propertyType: {
    type: String,
    enum: ["bed", "room", "shop"],
    default: "bed",
  },
  buildingName: { type: String, default: "" },
  scopeType: {
    type: String,
    enum: ["hostel", "room", "shop"],
    default: "hostel",
  },
  scopeName: { type: String, default: "" },
    mainAmount: {
    type: Number,
    required: true,
  },
  expenses: {
    type: [String],
    required: true,
  },
  date: {
    type: Date,
    required: true,
  },
   status: {
    type: String,
    enum: ['paid', 'pending'],
    default: 'pending'
  },
  createdByName: { type: String, default: "" },
  updatedByName: { type: String, default: "" },
}, {
  timestamps: true
});

otherExpenseSchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model('OtherExpense', otherExpenseSchema);
