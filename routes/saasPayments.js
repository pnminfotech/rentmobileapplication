const express = require("express");

const Organization = require("../models/Organization");
const SystemUser = require("../models/SystemUser");
const Subscription = require("../models/Subscription");
const BillingTransaction = require("../models/BillingTransaction");
const { requireSystemAuth, requireRole } = require("../middleware/saasAuth");
const { addMonths } = require("../utils/saas");
const {
  ensureReferralCodeForOrganization,
  grantReferralRewardFromTransaction,
} = require("../services/referralService");
const { debitWalletUsageFromTransaction } = require("../services/walletService");
const { createPaymentIntent } = require("../services/paymentProviders");
const { isPastDate } = require("../services/subscriptionLifecycle");
const {
  notifyOrganization,
  notifySuperadmins,
  resolveNotifications,
} = require("../services/notificationService");
const {
  checkPhonePeOrderStatus,
  mapPhonePeWebhookPayload,
} = require("../services/phonePeService");

const router = express.Router();

async function resolveSubscriptionPaymentNotifications(subscription, previousSubscription) {
  if (!subscription?._id) return;
  await Promise.allSettled([
    resolveNotifications({
      organizationId: subscription.organizationId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_payment_required",
    }),
    resolveNotifications({
      organizationId: subscription.organizationId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "renewal_payment_required",
    }),
    resolveNotifications({
      organizationId: subscription.organizationId,
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_expiry",
    }),
    previousSubscription?._id
      ? resolveNotifications({
          organizationId: subscription.organizationId,
          entityType: "subscription",
          entityId: previousSubscription._id,
          actionType: "subscription_expiry",
        })
      : Promise.resolve(),
  ]);
}

async function activatePaidSubscription(transaction, payload = {}) {
  const subscription = await Subscription.findById(transaction.subscriptionId);
  if (!subscription) {
    const err = new Error("Subscription not found");
    err.status = 404;
    throw err;
  }

  const previousSubscriptionId =
    transaction.requestPayload?.previousSubscriptionId ||
    transaction.responsePayload?.previousSubscriptionId ||
    null;
  const previousSubscription = previousSubscriptionId
    ? await Subscription.findById(previousSubscriptionId)
    : null;
  const now = new Date();
  const startDate = payload.startDate
    ? new Date(payload.startDate)
    : previousSubscription?.endDate && !isPastDate(previousSubscription.endDate, now)
      ? new Date(previousSubscription.endDate)
      : now;
  const endDate = addMonths(startDate, subscription.durationMonths);

  transaction.status = "success";
  transaction.callbackPayload = payload;
  transaction.paidAt = transaction.paidAt || startDate;
  await transaction.save();

  subscription.status = "active";
  subscription.startDate = subscription.startDate || startDate;
  subscription.endDate = subscription.endDate || endDate;
  subscription.latestTransactionId = transaction._id;
  await subscription.save();

  if (previousSubscription && previousSubscription.status === "active") {
    previousSubscription.status = isPastDate(previousSubscription.endDate, now) ? "expired" : "cancelled";
    await previousSubscription.save();
  }

  await Organization.findByIdAndUpdate(subscription.organizationId, {
    $set: {
      status: "active",
      activatedAt: startDate,
    },
  });

  await SystemUser.updateMany(
    { organizationId: subscription.organizationId },
    { $set: { status: "active" } }
  );

  await grantReferralRewardFromTransaction(transaction);
  await debitWalletUsageFromTransaction(transaction, "renewal_discount_used");
  await ensureReferralCodeForOrganization(subscription.organizationId);

  const organization = await Organization.findById(subscription.organizationId).lean();
  await resolveSubscriptionPaymentNotifications(subscription, previousSubscription);
  await Promise.allSettled([
    notifyOrganization(subscription.organizationId, {
      type: "payment_confirmation",
      title: previousSubscription ? "Subscription renewed" : "Subscription activated",
      message: `Payment of ${transaction.amount} ${transaction.currency || "INR"} received. Subscription is active until ${subscription.endDate.toLocaleDateString("en-IN")}.`,
      priority: "high",
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_payment_success",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      payload: {
        transactionId: String(transaction._id),
        subscriptionId: String(subscription._id),
        startDate,
        endDate,
      },
    }),
    notifySuperadmins({
      type: "payment_confirmation",
      title: "Subscription payment received",
      message: `${organization?.name || "Organization"} paid ${transaction.amount} ${transaction.currency || "INR"}.`,
      priority: "normal",
      entityType: "subscription",
      entityId: subscription._id,
      actionType: "subscription_payment_success",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      payload: {
        organizationId: String(subscription.organizationId),
        transactionId: String(transaction._id),
        subscriptionId: String(subscription._id),
        amount: transaction.amount,
        currency: transaction.currency || "INR",
      },
    }),
  ]);

  return subscription;
}

function canAccessTransaction(req, transaction) {
  if (req.systemUser?.role === "superadmin") return true;
  return (
    req.organizationId &&
    String(transaction.organizationId) === String(req.organizationId)
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function resolveStoredPhonePeUrl(transaction) {
  const payload = transaction?.responsePayload || {};
  return (
    payload.directPaymentUrl ||
    payload.raw?.redirectUrl ||
    payload.raw?.paymentUrl ||
    payload.raw?.instrumentResponse?.redirectInfo?.url ||
    payload.raw?.data?.instrumentResponse?.redirectInfo?.url ||
    payload.raw?.data?.redirectUrl ||
    payload.raw?.data?.paymentUrl ||
    payload.paymentUrl ||
    ""
  );
}

async function handlePhonePeCheckoutPage(req, res) {
  try {
    const transaction = await BillingTransaction.findById(req.params.transactionId).lean();
    if (!transaction) return res.status(404).send("Payment transaction not found");

    const tokenUrl = resolveStoredPhonePeUrl(transaction);
    if (!tokenUrl) return res.status(404).send("PhonePe payment URL not found");

    const returnUrl = process.env.PHONEPE_APP_RETURN_URL || process.env.FRONTEND_PAYMENT_RETURN_URL || "rentmanagementmobile://login";
    res
      .status(200)
      .send(`<!doctype html>
<html>
  <head>
    <title>PhonePe Checkout</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script src="https://mercury.phonepe.com/web/bundle/checkout.js"></script>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #fff8f1; color: #111827; }
      main { width: min(420px, calc(100% - 32px)); padding: 24px; border: 1px solid #efe0d3; border-radius: 14px; background: #fffdf9; text-align: center; box-shadow: 0 10px 28px rgba(74, 33, 56, 0.12); }
      h2 { margin: 0 0 8px; font-size: 24px; }
      p { color: #6b7280; line-height: 1.5; }
      button, a { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; margin-top: 12px; padding: 0 18px; border: 0; border-radius: 8px; background: #7a365d; color: white; text-decoration: none; font-weight: 800; font-size: 15px; }
      a.secondary { background: transparent; color: #7a365d; border: 1px solid #7a365d; }
      #message { min-height: 22px; font-size: 13px; }
    </style>
  </head>
  <body>
    <main>
      <h2>Complete Payment</h2>
      <p id="message">Tap below to continue securely with PhonePe.</p>
      <button id="payButton" type="button">Proceed to PhonePe</button>
      <br />
      <a class="secondary" href="${escapeHtml(returnUrl)}?payment=submitted&source=phonepe">Back to EazyRent</a>
    </main>
    <script>
      const tokenUrl = ${JSON.stringify(tokenUrl)};
      const returnUrl = ${JSON.stringify(`${returnUrl}?payment=submitted&source=phonepe`)};
      const message = document.getElementById("message");
      function openCheckout() {
        message.textContent = "Opening PhonePe...";
        if (window.PhonePeCheckout && window.PhonePeCheckout.transact) {
          window.PhonePeCheckout.transact({
            tokenUrl,
            type: "IFRAME",
            callback: function (response) {
              if (response === "USER_CANCEL") {
                message.textContent = "Payment was cancelled. You can try again.";
                return;
              }
              window.location.href = returnUrl;
            }
          });
          return;
        }
        window.location.href = tokenUrl;
      }
      document.getElementById("payButton").addEventListener("click", openCheckout);
      window.addEventListener("load", function () {
        message.textContent = "Tap below to continue securely with PhonePe.";
      });
    </script>
  </body>
</html>`);
  } catch (err) {
    console.error("phonepe checkout page error:", err);
    res.status(500).send("Unable to open payment checkout");
  }
}

function formatReturnDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

async function handlePhonePeReturn(req, res) {
  try {
    const transactionId = req.query?.transactionId || req.query?.billingTransactionId;
    const merchantOrderId =
      req.query?.merchantOrderId || req.query?.merchantTransactionId || req.query?.orderId;
    const query = transactionId
      ? { _id: transactionId }
      : {
          $or: [
            { merchantTransactionId: merchantOrderId },
            { "responsePayload.merchantOrderId": merchantOrderId },
            { "responsePayload.merchantTransactionId": merchantOrderId },
          ],
        };

    if (!transactionId && !merchantOrderId) {
      return res.status(400).send("Payment reference not found");
    }

    const transaction = await BillingTransaction.findOne(query);
    if (!transaction) return res.status(404).send("Payment transaction not found");

    const provider = String(transaction.responsePayload?.provider || transaction.provider || "").toLowerCase();
    if (provider === "phonepe" && ["created", "pending"].includes(transaction.status)) {
      try {
        const providerStatus = await checkPhonePeOrderStatus(
          transaction.responsePayload?.merchantOrderId ||
            transaction.responsePayload?.merchantTransactionId ||
            transaction.merchantTransactionId
        );
        transaction.status = providerStatus.status;
        transaction.callbackPayload = {
          ...(transaction.callbackPayload || {}),
          returnStatusPoll: providerStatus,
          returnedAt: new Date(),
        };
        await transaction.save();
        if (providerStatus.status === "success") {
          await activatePaidSubscription(transaction, {
            source: "phonepe-return",
            status: providerStatus.status,
            providerStatus,
          });
        }
      } catch (pollError) {
        console.error("phonepe return status check error:", pollError);
      }
    }

    const [subscription, organization] = await Promise.all([
      Subscription.findById(transaction.subscriptionId).lean(),
      Organization.findById(transaction.organizationId).lean(),
    ]);
    const status = String(transaction.status || "pending").toLowerCase();
    const title = status === "success" ? "Payment verified" : status === "failed" ? "Payment failed" : "Payment pending";
    const message = status === "success"
      ? "Your subscription is active. Please login to start using EazyRent."
      : status === "failed"
        ? "The payment was not completed. Please login and try again."
        : "We received the payment response, but confirmation is still pending. Please login shortly to check your subscription.";
    const loginUrl = process.env.FRONTEND_LOGIN_URL || "rentmanagementmobile://login";
    const rows = [
      ["Status", status.toUpperCase()],
      ["Organization", organization?.name],
      ["Purchase amount", `${transaction.amount || 0} ${transaction.currency || "INR"}`],
      ["Subscription", `${subscription?.durationMonths || "-"} months`],
      ["Start date", formatReturnDate(subscription?.startDate)],
      ["Expiry date", formatReturnDate(subscription?.endDate)],
      ["Paid at", formatReturnDate(transaction.paidAt)],
      ["Transaction ID", transaction._id],
    ]
      .map(([label, value]) => `<div class="row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || "-")}</strong></div>`)
      .join("");

    return res.status(200).send(`<!doctype html>
<html><head><title>${escapeHtml(title)}</title><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box;font-family:Arial,sans-serif;background:#f4f7f6;color:#16211d}
main{width:min(520px,100%);padding:28px;box-sizing:border-box;border:1px solid #d8e5df;border-radius:16px;background:#fff;box-shadow:0 12px 32px rgba(22,33,29,.1)}
.icon{font-size:42px}.success{color:#16845b}.failed{color:#c0392b}.pending{color:#a66a00}h1{margin:8px 0;color:#16211d;font-size:28px}p{color:#5d6b65;line-height:1.5}.details{margin:22px 0;border-top:1px solid #e4ece8}.row{display:flex;justify-content:space-between;gap:20px;padding:12px 0;border-bottom:1px solid #e4ece8;font-size:14px}.row span{color:#68766f}.row strong{text-align:right;overflow-wrap:anywhere}a{display:block;padding:14px;border-radius:9px;background:#167653;color:#fff;text-align:center;text-decoration:none;font-weight:700}
</style></head><body><main><div class="icon ${escapeHtml(status)}">${status === "success" ? "&#10003;" : status === "failed" ? "&#10007;" : "&#8987;"}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><div class="details">${rows}</div><a id="loginButton" href="${escapeHtml(loginUrl)}">Login to EazyRent</a><p id="loginHint" hidden>Open this page on the device where EazyRent is installed, then tap the button again.</p></main><script>
const loginButton = document.getElementById("loginButton");
const loginHint = document.getElementById("loginHint");
loginButton.addEventListener("click", function (event) {
  event.preventDefault();
  window.location.assign(${JSON.stringify(loginUrl)});
  setTimeout(function () {
    loginHint.hidden = false;
  }, 1500);
});
</script></body></html>`);
  } catch (err) {
    console.error("phonepe return page error:", err);
    return res.status(500).send("Unable to verify payment");
  }
}

router.post("/create", requireSystemAuth, async (req, res) => {
  try {
    const transactionId = req.body?.transactionId || req.body?.billingTransactionId;
    const subscriptionId = req.body?.subscriptionId;

    const query = transactionId
      ? { _id: transactionId }
      : { subscriptionId, status: { $in: ["created", "pending"] } };

    if (!query._id && !subscriptionId) {
      return res.status(400).json({ message: "transactionId or subscriptionId is required" });
    }

    const transaction = await BillingTransaction.findOne(query).sort({ createdAt: -1 });
    if (!transaction) return res.status(404).json({ message: "Payment transaction not found" });
    if (!canAccessTransaction(req, transaction)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const [organization, subscription] = await Promise.all([
      Organization.findById(transaction.organizationId),
      Subscription.findById(transaction.subscriptionId),
    ]);

    if (!organization || !subscription) {
      return res.status(404).json({ message: "Payment context not found" });
    }

    const intent = await createPaymentIntent({ transaction, organization, subscription });

    transaction.merchantTransactionId = intent.merchantTransactionId || transaction.merchantTransactionId;
    transaction.status = intent.status || "pending";
    transaction.requestPayload = {
      ...(transaction.requestPayload || {}),
      requestedBy: req.systemUser._id,
      provider: intent.provider,
      at: new Date(),
    };
    transaction.responsePayload = intent;
    await transaction.save();

    res.json({
      transaction,
      payment: intent,
    });
  } catch (err) {
    console.error("create saas payment error:", err);
    res.status(500).json({
      message: err.message || "Unable to create payment. Please try again or contact support.",
    });
  }
});

router.get("/:transactionId/status", requireSystemAuth, async (req, res) => {
  try {
    const transaction = await BillingTransaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: "Payment transaction not found" });
    if (!canAccessTransaction(req, transaction)) {
      return res.status(403).json({ message: "Access denied" });
    }

    let providerStatus = null;
    const provider = String(transaction.responsePayload?.provider || transaction.provider || "").toLowerCase();
    const merchantOrderId =
      transaction.responsePayload?.merchantOrderId ||
      transaction.responsePayload?.merchantTransactionId ||
      transaction.merchantTransactionId;

    if (provider === "phonepe" && merchantOrderId && ["created", "pending"].includes(transaction.status)) {
      providerStatus = await checkPhonePeOrderStatus(merchantOrderId);
      transaction.callbackPayload = {
        ...(transaction.callbackPayload || {}),
        latestStatusPoll: providerStatus,
        polledAt: new Date(),
      };
      transaction.status = providerStatus.status;
      await transaction.save();
      if (providerStatus.status === "success") {
        await activatePaidSubscription(transaction, {
          source: "phonepe-status",
          status: providerStatus.status,
          providerStatus,
        });
      }
    }

    const subscription = await Subscription.findById(transaction.subscriptionId).lean();

    res.json({
      transaction,
      subscription,
      providerStatus,
    });
  } catch (err) {
    console.error("saas payment status error:", err);
    res.status(500).json({ message: err.message || "Unable to check payment status" });
  }
});

async function handleMockSuccess(req, res) {
  try {
    const paymentProvider = String(process.env.PAYMENT_PROVIDER || "mock").toLowerCase();
    const phonePeEnv = String(process.env.PHONEPE_ENV || "").toLowerCase();
    const allowPhonePeUatSuccess =
      paymentProvider === "phonepe" &&
      phonePeEnv === "uat" &&
      String(process.env.PHONEPE_ALLOW_UAT_SUCCESS || "").toLowerCase() === "true";

    if (paymentProvider !== "mock" && !allowPhonePeUatSuccess) {
      return res.status(403).json({ message: "Test payment completion is disabled" });
    }

    const transaction = await BillingTransaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: "Payment transaction not found" });

    if (transaction.status === "success") {
      const subscription = await Subscription.findById(transaction.subscriptionId);
      return res.json({ transaction, subscription, message: "Payment already successful" });
    }

    const subscription = await activatePaidSubscription(transaction, {
      source: allowPhonePeUatSuccess ? "phonepe-uat-test" : "mock",
      status: "success",
      body: req.body || {},
    });

    res.json({
      transaction,
      subscription,
      message: allowPhonePeUatSuccess
        ? "PhonePe UAT test payment marked successful. Subscription activated."
        : "Mock payment successful. Subscription activated.",
    });
  } catch (err) {
    console.error("mock payment success error:", err);
    res.status(err.status || 500).json({ message: err.message || "Server error" });
  }
}

router.get("/mock/success/:transactionId", handleMockSuccess);
router.post("/mock/success/:transactionId", handleMockSuccess);

router.post("/mock/fail/:transactionId", async (req, res) => {
  try {
    if (String(process.env.PAYMENT_PROVIDER || "mock").toLowerCase() !== "mock") {
      return res.status(403).json({ message: "Mock payments are disabled" });
    }

    const transaction = await BillingTransaction.findById(req.params.transactionId);
    if (!transaction) return res.status(404).json({ message: "Payment transaction not found" });

    transaction.status = "failed";
    transaction.callbackPayload = {
      source: "mock",
      status: "failed",
      body: req.body || {},
    };
    await transaction.save();

    res.json({
      transaction,
      message: "Mock payment marked as failed.",
    });
  } catch (err) {
    console.error("mock payment fail error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

async function handlePhonePeWebhook(req, res) {
  try {
    const mapped = mapPhonePeWebhookPayload(req.body || {});
    if (!mapped.merchantOrderId) {
      return res.status(400).json({ ok: false, message: "merchantOrderId missing in PhonePe webhook" });
    }

    const transaction = await BillingTransaction.findOne({
      $or: [
        { merchantTransactionId: mapped.merchantOrderId },
        { "responsePayload.merchantOrderId": mapped.merchantOrderId },
        { "responsePayload.merchantTransactionId": mapped.merchantOrderId },
      ],
    });

    if (!transaction) {
      return res.status(404).json({ ok: false, message: "Payment transaction not found" });
    }

    transaction.callbackPayload = {
      source: "phonepe-webhook",
      receivedAt: new Date(),
      mapped,
      body: req.body || {},
      headers: {
        authorization: req.get("authorization") || "",
        xVerify: req.get("x-verify") || req.get("x-verify-response") || "",
      },
    };
    transaction.status = mapped.status;
    await transaction.save();

    let subscription = await Subscription.findById(transaction.subscriptionId);
    if (mapped.status === "success") {
      subscription = await activatePaidSubscription(transaction, {
        source: "phonepe-webhook",
        status: mapped.status,
        webhook: mapped,
      });
    }

    return res.json({ ok: true, transaction, subscription });
  } catch (err) {
    console.error("phonepe webhook error:", err);
    return res.status(err.status || 500).json({ ok: false, message: err.message || "Server error" });
  }
}

router.get("/phonepe/checkout/:transactionId", handlePhonePeCheckoutPage);
router.post("/phonepe/callback", handlePhonePeWebhook);
router.post("/phonepe/webhook", handlePhonePeWebhook);

router.get(
  "/admin/transactions",
  requireSystemAuth,
  requireRole("superadmin"),
  async (req, res) => {
    const { status = "all", limit = 50 } = req.query;
    const query = status === "all" ? {} : { status };
    const transactions = await BillingTransaction.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit) || 50)
      .populate("organizationId", "name ownerName email phone status")
      .populate("subscriptionId", "status startDate endDate amount durationMonths");

    res.json(transactions);
  }
);

module.exports = router;
module.exports.handlePhonePeWebhook = handlePhonePeWebhook;
module.exports.handlePhonePeCheckoutPage = handlePhonePeCheckoutPage;
module.exports.handlePhonePeReturn = handlePhonePeReturn;
