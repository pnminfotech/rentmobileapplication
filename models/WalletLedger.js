const mongoose = require("mongoose");

const walletLedgerSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "referral_reward",
        "renewal_discount_used",
        "upgrade_discount_used",
        "manual_credit",
        "manual_debit",
      ],
      required: true,
      index: true,
    },
    direction: {
      type: String,
      enum: ["credit", "debit"],
      required: true,
    },
    coins: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    description: { type: String, trim: true, default: "" },
    referenceType: { type: String, trim: true, default: "" },
    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

walletLedgerSchema.index({ organizationId: 1, createdAt: -1 });
walletLedgerSchema.index({ referenceType: 1, referenceId: 1, type: 1 });

module.exports =
  mongoose.models.WalletLedger ||
  mongoose.model("WalletLedger", walletLedgerSchema);
