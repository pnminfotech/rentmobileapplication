const crypto = require("crypto");

const Organization = require("../models/Organization");
const ReferralCode = require("../models/ReferralCode");
const { slugify, normalizeDiscountPercent } = require("../utils/saas");
const { creditReferralReward } = require("./walletService");

function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 24);
}

function defaultBuyerDiscountPercent() {
  return normalizeDiscountPercent(process.env.REFERRAL_BUYER_DISCOUNT_PERCENT || 0);
}

function defaultRewardCoins() {
  const coins = Number(process.env.REFERRAL_REWARD_COINS || 100);
  return Number.isFinite(coins) && coins >= 0 ? Math.round(coins) : 100;
}

async function uniqueReferralCode(seed) {
  const base = normalizeReferralCode(slugify(seed).replace(/-/g, "").slice(0, 10)) || "EZYRT";
  for (let index = 0; index < 20; index += 1) {
    const suffix = crypto.randomInt(1000, 9999);
    const candidate = normalizeReferralCode(`${base}${suffix}`);
    const exists = await ReferralCode.exists({ code: candidate });
    if (!exists) return candidate;
  }
  return normalizeReferralCode(`EZYRT${Date.now().toString().slice(-8)}`);
}

async function ensureReferralCodeForOrganization(organizationId) {
  if (!organizationId) return null;
  const existing = await ReferralCode.findOne({
    ownerOrganizationId: organizationId,
    source: "auto_system_admin",
  });
  if (existing) return existing;

  const organization = await Organization.findById(organizationId).lean();
  if (!organization) return null;

  return ReferralCode.create({
    code: await uniqueReferralCode(organization.name || organization.ownerName || organization.email),
    title: `${organization.name} referral code`,
    discountPercent: defaultBuyerDiscountPercent(),
    rewardCoins: defaultRewardCoins(),
    ownerOrganizationId: organization._id,
    source: "auto_system_admin",
    isActive: true,
  });
}

async function grantReferralRewardFromTransaction(transaction) {
  const referralCode = normalizeReferralCode(transaction?.pricing?.referralCode);
  const ownerOrganizationId = transaction?.pricing?.referralOwnerOrganizationId;
  if (!referralCode || !ownerOrganizationId || transaction?.pricing?.referralRewardGranted) {
    return null;
  }
  if (String(ownerOrganizationId) === String(transaction.organizationId)) {
    return null;
  }

  const coins = Number(transaction.pricing.referralRewardCoins || defaultRewardCoins());
  const rewardCoins = Number.isFinite(coins) && coins >= 0 ? Math.round(coins) : defaultRewardCoins();
  const referral = await ReferralCode.findOneAndUpdate(
    { code: referralCode, ownerOrganizationId },
    {
      $inc: {
        usedCount: 1,
        earnedCoins: rewardCoins,
      },
    },
    { new: true }
  );

  if (!referral) return null;
  await creditReferralReward({
    organizationId: ownerOrganizationId,
    coins: rewardCoins,
    referralCode,
    transactionId: transaction._id,
    referredOrganizationId: transaction.organizationId,
  });
  transaction.pricing.referralRewardGranted = true;
  await transaction.save();
  return referral;
}

module.exports = {
  normalizeReferralCode,
  defaultBuyerDiscountPercent,
  defaultRewardCoins,
  ensureReferralCodeForOrganization,
  grantReferralRewardFromTransaction,
};
