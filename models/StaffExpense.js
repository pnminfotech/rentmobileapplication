const mongoose = require("mongoose");

const staffExpenseSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    type: { type: String, required: true },   // Employee, Cleaning Lady...
    name: { type: String, required: true },
    amount: { type: Number, required: true },
    notes: { type: String, default: "" },
    status: { type: String, enum: ["pending", "paid"], default: "pending" },
    date: { type: Date, required: true },     // store YYYY-MM-01
    createdByName: { type: String, default: "" },
    updatedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

staffExpenseSchema.index({ organizationId: 1, date: -1 });
staffExpenseSchema.index({ organizationId: 1, date: 1, type: 1, name: 1 });

module.exports = mongoose.model("StaffExpense", staffExpenseSchema);
