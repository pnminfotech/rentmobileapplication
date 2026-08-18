const { createPhonePePayment } = require("./phonePeService");

function getPaymentProviderName() {
  return String(process.env.PAYMENT_PROVIDER || "mock").trim().toLowerCase();
}

function buildMockPaymentUrl(transaction) {
  const publicBase =
    process.env.PUBLIC_API_BASE_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    `http://localhost:${process.env.PORT || 8000}`;

  return `${String(publicBase).replace(/\/+$/, "")}/api/saas/payments/mock/success/${transaction._id}`;
}

async function createPaymentIntent({ transaction, organization, subscription }) {
  const provider = getPaymentProviderName();

  if (provider === "phonepe") {
    return createPhonePePayment({ transaction, organization, subscription });
  }

  if (provider !== "mock") {
    return {
      provider,
      status: "pending",
      paymentUrl: null,
      message: "Unsupported payment provider configured.",
      raw: {
        note: `Set PAYMENT_PROVIDER=mock or PAYMENT_PROVIDER=phonepe. Current: ${provider}`,
      },
    };
  }

  return {
    provider: "mock",
    status: "pending",
    paymentUrl: buildMockPaymentUrl(transaction),
    merchantTransactionId: transaction.merchantTransactionId,
    amount: transaction.amount,
    currency: transaction.currency,
    raw: {
      organizationId: String(organization._id),
      subscriptionId: String(subscription._id),
      testMode: true,
    },
  };
}

module.exports = {
  getPaymentProviderName,
  createPaymentIntent,
};
