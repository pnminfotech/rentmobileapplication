const WalletLedger = require("../models/WalletLedger");

function normalizeCoins(value) {
  const coins = Number(value || 0);
  return Number.isFinite(coins) && coins > 0 ? Math.round(coins) : 0;
}

async function getWalletBalance(organizationId) {
  if (!organizationId) return 0;
  const latest = await WalletLedger.findOne({ organizationId })
    .sort({ createdAt: -1, _id: -1 })
    .lean();
  return Number(latest?.balanceAfter || 0);
}

async function addWalletEntry({
  organizationId,
  type,
  direction,
  coins,
  description = "",
  referenceType = "",
  referenceId = null,
  meta = {},
}) {
  const normalizedCoins = normalizeCoins(coins);
  if (!organizationId || !normalizedCoins) return null;

  const currentBalance = await getWalletBalance(organizationId);
  const nextBalance =
    direction === "debit"
      ? Math.max(0, currentBalance - normalizedCoins)
      : currentBalance + normalizedCoins;

  return WalletLedger.create({
    organizationId,
    type,
    direction,
    coins: normalizedCoins,
    balanceAfter: nextBalance,
    description,
    referenceType,
    referenceId,
    meta,
  });
}

async function creditReferralReward({ organizationId, coins, referralCode, transactionId, referredOrganizationId }) {
  if (!organizationId || !transactionId) return null;
  const existing = await WalletLedger.exists({
    organizationId,
    type: "referral_reward",
    referenceType: "billing_transaction",
    referenceId: transactionId,
  });
  if (existing) return null;

  return addWalletEntry({
    organizationId,
    type: "referral_reward",
    direction: "credit",
    coins,
    description: `Referral reward for ${referralCode}`,
    referenceType: "billing_transaction",
    referenceId: transactionId,
    meta: {
      referralCode,
      referredOrganizationId,
    },
  });
}

async function debitWalletUsageFromTransaction(transaction, type = "renewal_discount_used") {
  const coins = normalizeCoins(transaction?.pricing?.walletCoinsUsed);
  if (!transaction?.organizationId || !transaction?._id || !coins || transaction?.pricing?.walletDebitGranted) {
    return null;
  }

  const existing = await WalletLedger.exists({
    organizationId: transaction.organizationId,
    type,
    referenceType: "billing_transaction",
    referenceId: transaction._id,
  });
  if (existing) return null;

  const entry = await addWalletEntry({
    organizationId: transaction.organizationId,
    type,
    direction: "debit",
    coins,
    description: type === "upgrade_discount_used" ? "Wallet coins used for package upgrade" : "Wallet coins used for renewal",
    referenceType: "billing_transaction",
    referenceId: transaction._id,
    meta: {
      amount: transaction.amount,
      merchantTransactionId: transaction.merchantTransactionId,
    },
  });

  transaction.pricing.walletDebitGranted = true;
  await transaction.save();
  return entry;
}

async function getWalletSummary(organizationId, limit = 50) {
  const [balance, entries] = await Promise.all([
    getWalletBalance(organizationId),
    WalletLedger.find({ organizationId })
      .sort({ createdAt: -1, _id: -1 })
      .limit(Math.min(Math.max(Number(limit || 50), 1), 100))
      .lean(),
  ]);
  return { balance, entries };
}

module.exports = {
  getWalletBalance,
  addWalletEntry,
  creditReferralReward,
  debitWalletUsageFromTransaction,
  getWalletSummary,
};
