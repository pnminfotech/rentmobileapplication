function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeUnits(units) {
  return {
    beds: Math.max(0, Number(units?.beds || 0)),
    rooms: Math.max(0, Number(units?.rooms || 0)),
    shops: Math.max(0, Number(units?.shops || 0)),
  };
}

function normalizeDiscountPercent(value) {
  const discount = Number(value || 0);
  if (!Number.isFinite(discount)) return 0;
  return Math.min(100, Math.max(0, discount));
}

function applyDiscount(amount, discountPercent) {
  const subtotal = Math.max(0, Number(amount || 0));
  const discount = normalizeDiscountPercent(discountPercent);
  if (discount <= 0) return Math.round(subtotal);
  return Math.round(subtotal - (subtotal * discount) / 100);
}

function calculateSubscriptionAmount(plan, units) {
  return calculateSubscriptionPricing(plan, units).payableAmount;
}

function calculateSubscriptionPricing(plan, units, referral = null) {
  const normalizedUnits = normalizeUnits(units);
  const pricing = plan?.unitPricing || {};
  const months = Number(plan?.durationMonths || 0);
  const baseAmount = Number(plan?.baseAmount || 0);
  const planDiscountPercent = normalizeDiscountPercent(plan?.discountPercent);
  const referralDiscountPercent = normalizeDiscountPercent(referral?.discountPercent);

  const subtotal =
    baseAmount +
    months *
      (normalizedUnits.beds * Number(pricing.bedMonthly || 0) +
        normalizedUnits.rooms * Number(pricing.roomMonthly || 0) +
        normalizedUnits.shops * Number(pricing.shopMonthly || 0));

  const afterPlanDiscount = applyDiscount(subtotal, planDiscountPercent);
  const planDiscountAmount = Math.max(0, Math.round(subtotal - afterPlanDiscount));
  const payableAmount = applyDiscount(afterPlanDiscount, referralDiscountPercent);
  const referralDiscountAmount = Math.max(0, Math.round(afterPlanDiscount - payableAmount));

  return {
    subtotal: Math.round(subtotal),
    planDiscountPercent,
    planDiscountAmount,
    referralCode: referral?.code || "",
    referralOwnerOrganizationId: referral?.ownerOrganizationId || null,
    referralDiscountPercent,
    referralDiscountAmount,
    referralRewardCoins: Number(referral?.rewardCoins || 0),
    referralRewardGranted: false,
    payableAmount,
  };
}

function addMonths(date, months) {
  const out = new Date(date);
  out.setMonth(out.getMonth() + Number(months || 0));
  return out;
}

module.exports = {
  slugify,
  normalizeUnits,
  normalizeDiscountPercent,
  applyDiscount,
  calculateSubscriptionPricing,
  calculateSubscriptionAmount,
  addMonths,
};
