const crypto = require("crypto");

let cachedToken = null;

function trimEndSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function originFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return `${url.protocol}//${url.host}`;
  } catch (_err) {
    return "";
  }
}

function appendUrlParams(value, params = {}) {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    Object.entries(params).forEach(([key, paramValue]) => {
      if (paramValue !== undefined && paramValue !== null && paramValue !== "") {
        url.searchParams.set(key, String(paramValue));
      }
    });
    return url.toString();
  } catch (_err) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, paramValue]) => {
      if (paramValue !== undefined && paramValue !== null && paramValue !== "") {
        query.set(key, String(paramValue));
      }
    });
    const separator = String(value).includes("?") ? "&" : "?";
    return query.toString() ? `${value}${separator}${query.toString()}` : String(value);
  }
}

function envValue(key, fallback = "") {
  return String(process.env[key] || fallback).trim();
}

function phonePeConfig() {
  const env = envValue("PHONEPE_ENV", "uat").toLowerCase();
  const clientId = envValue("PHONEPE_CLIENT_ID");
  const clientSecret = envValue("PHONEPE_CLIENT_SECRET");
  const clientVersion = envValue("PHONEPE_CLIENT_VERSION", "1");
  const authUrl = envValue("PHONEPE_AUTH_URL", "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token");
  const payBaseUrl = trimEndSlash(envValue("PHONEPE_PAY_BASE_URL", "https://api-preprod.phonepe.com/apis/pg-sandbox"));
  const statusBaseUrl = trimEndSlash(envValue("PHONEPE_STATUS_BASE_URL", payBaseUrl));
  const publicBase = envValue("PUBLIC_API_BASE_URL") || envValue("BACKEND_PUBLIC_URL");
  const redirectUrl =
    envValue("PHONEPE_REDIRECT_URL") ||
    envValue("PHONEPE_GATEWAY_REDIRECT_URL") ||
    (publicBase ? `${trimEndSlash(publicBase)}/api/saas/payments/phonepe/return` : "");
  const appReturnUrl =
    envValue("PHONEPE_APP_RETURN_URL") ||
    envValue("FRONTEND_PAYMENT_RETURN_URL") ||
    envValue("PHONEPE_DEEP_LINK_RETURN_URL") ||
    "rentmanagementmobile://payment-result";
  const checkoutBaseUrl =
    envValue("PHONEPE_CHECKOUT_BASE_URL") ||
    publicBase ||
    originFromUrl(redirectUrl);

  return {
    env,
    clientId,
    clientSecret,
    clientVersion,
    authUrl,
    payBaseUrl,
    statusBaseUrl,
    redirectUrl,
    appReturnUrl,
    checkoutBaseUrl: trimEndSlash(checkoutBaseUrl),
  };
}

function ensurePhonePeConfig(config = phonePeConfig()) {
  const missing = [];
  if (!config.clientId) missing.push("PHONEPE_CLIENT_ID");
  if (!config.clientSecret) missing.push("PHONEPE_CLIENT_SECRET");
  if (!config.clientVersion) missing.push("PHONEPE_CLIENT_VERSION");
  if (!config.authUrl) missing.push("PHONEPE_AUTH_URL");
  if (!config.payBaseUrl) missing.push("PHONEPE_PAY_BASE_URL");
  if (!config.statusBaseUrl) missing.push("PHONEPE_STATUS_BASE_URL");
  if (missing.length) {
    const err = new Error(`PhonePe configuration missing: ${missing.join(", ")}`);
    err.status = 500;
    throw err;
  }
}

function amountToPaise(amount) {
  return Math.max(0, Math.round(Number(amount || 0) * 100));
}

function resolvePaymentUrl(data = {}) {
  return (
    data.redirectUrl ||
    data.paymentUrl ||
    data.instrumentResponse?.redirectInfo?.url ||
    data.data?.instrumentResponse?.redirectInfo?.url ||
    data.data?.redirectUrl ||
    data.data?.paymentUrl ||
    null
  );
}

function resolveOrderState(data = {}) {
  return String(
    data.state ||
    data.status ||
    data.data?.state ||
    data.data?.status ||
    data.paymentState ||
    ""
  ).toUpperCase();
}

function mapPhonePeStateToTransactionStatus(state) {
  const normalized = String(state || "").toUpperCase();
  if (["COMPLETED", "SUCCESS", "PAYMENT_SUCCESS"].includes(normalized)) return "success";
  if (["FAILED", "PAYMENT_ERROR", "DECLINED"].includes(normalized)) return "failed";
  if (["CANCELLED", "CANCELED"].includes(normalized)) return "cancelled";
  return "pending";
}

async function getPhonePeAccessToken() {
  const config = phonePeConfig();
  ensurePhonePeConfig(config);

  if (cachedToken?.token && cachedToken.expiresAt > Date.now() + 60000) {
    return cachedToken.token;
  }

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    client_version: config.clientVersion,
    grant_type: "client_credentials",
  });

  const response = await fetch(config.authUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error_description || `PhonePe auth failed with ${response.status}`);
  }

  const token = data.access_token || data.token || data.data?.access_token;
  if (!token) throw new Error("PhonePe auth did not return an access token");

  const expiresIn = Number(data.expires_in || data.data?.expires_in || 300);
  cachedToken = {
    token,
    expiresAt: Date.now() + Math.max(expiresIn - 30, 60) * 1000,
  };

  return token;
}

async function createPhonePePayment({ transaction, organization, subscription }) {
  const config = phonePeConfig();
  ensurePhonePeConfig(config);
  const token = await getPhonePeAccessToken();
  const merchantOrderId = `TXN${Date.now()}${crypto.randomInt(1000, 9999)}`;
  const amount = amountToPaise(transaction.amount);
  const gatewayRedirectUrl = appendUrlParams(config.redirectUrl, {
    transactionId: transaction._id,
    merchantOrderId,
  });

  const payload = {
    merchantOrderId,
    amount,
    expireAfter: Number(process.env.PHONEPE_EXPIRE_AFTER_SECONDS || 1200),
    metaInfo: {
      udf1: String(transaction._id),
      udf2: String(organization._id),
      udf3: String(subscription._id),
      udf4: String(process.env.APP_NAME || "EazyRent"),
    },
    paymentFlow: {
      type: "PG_CHECKOUT",
      message: `Subscription payment for ${organization.name || organization.businessName || "organization"}`,
      merchantUrls: gatewayRedirectUrl ? { redirectUrl: gatewayRedirectUrl } : undefined,
    },
  };

  const response = await fetch(`${config.payBaseUrl}/checkout/v2/pay`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `O-Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error_description || `PhonePe payment failed with ${response.status}`);
  }

  const directPaymentUrl = resolvePaymentUrl(data);
  const checkoutPageUrl = config.checkoutBaseUrl
    ? `${config.checkoutBaseUrl}/api/phonepe/checkout/${transaction._id}`
    : "";

  return {
    provider: "phonepe",
    status: "pending",
    paymentUrl: directPaymentUrl || checkoutPageUrl,
    checkoutPageUrl,
    directPaymentUrl,
    merchantTransactionId: merchantOrderId,
    merchantOrderId,
    amount: transaction.amount,
    amountInPaise: amount,
    currency: transaction.currency || "INR",
    raw: data,
  };
}

async function checkPhonePeOrderStatus(merchantOrderId) {
  const config = phonePeConfig();
  ensurePhonePeConfig(config);
  const token = await getPhonePeAccessToken();

  const response = await fetch(
    `${config.statusBaseUrl}/checkout/v2/order/${encodeURIComponent(String(merchantOrderId))}/status`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `O-Bearer ${token}`,
      },
    }
  );
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || data.error_description || `PhonePe status failed with ${response.status}`);
  }

  const state = resolveOrderState(data);
  return {
    provider: "phonepe",
    status: mapPhonePeStateToTransactionStatus(state),
    merchantOrderId,
    state,
    raw: data,
  };
}

function extractMerchantOrderId(payload = {}) {
  return (
    payload.merchantOrderId ||
    payload.orderId ||
    payload.data?.merchantOrderId ||
    payload.data?.orderId ||
    payload.eventData?.merchantOrderId ||
    payload.eventData?.orderId ||
    payload.payload?.merchantOrderId ||
    payload.payload?.orderId ||
    ""
  );
}

function mapPhonePeWebhookPayload(payload = {}) {
  const state = resolveOrderState(payload);
  return {
    provider: "phonepe",
    status: mapPhonePeStateToTransactionStatus(state),
    merchantOrderId: extractMerchantOrderId(payload),
    state,
    raw: payload,
  };
}

module.exports = {
  createPhonePePayment,
  checkPhonePeOrderStatus,
  mapPhonePeWebhookPayload,
};
