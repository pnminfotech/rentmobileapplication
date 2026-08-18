// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const { connectDB } = require("./config/db");
const { startSubscriptionReminderJob } = require("./services/subscriptionReminderService");
const { startRentReminderSmsJob } = require("./services/rentReminderSmsService");

// Routers
const formRoutes = require("./routes/formRoutes");
const maintenanceRoutes = require("./routes/MaintRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const projectRoutes = require("./routes/Project");
const roomRoutes = require("./routes/roomRoutes");
const commercialRoutes = require("./routes/commercialRoutes");
const lightBillRoutes = require("./routes/lightBillRoutes");
const otherExpenseRoutes = require("./routes/otherExpenseRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const authRoutes = require("./routes/authRoutes");
const formWithDocsRoutes = require("./routes/formWithDocs");
const documentRoutes = require("./routes/documentRoutes");
const tenantRoutes = require("./routes/tenant");
const paymentRoutes = require("./routes/payments");
const leaveRoutes = require("./routes/leaveRoutes");
const adminNotificationsRouter = require("./routes/adminattendenceNotifications");
const adminLeaveRoutes = require("./routes/adminLeaveRoutes");
const tenantDocsRoutes = require("./routes/tenantDocs");
const invitesRouter = require("./routes/invites");
const saasRoutes = require("./routes/saas");
const saasPaymentRoutes = require("./routes/saasPayments");
const auditLogRoutes = require("./routes/auditLogRoutes");

const app = express();

const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "https://pnminfotech.com",
  "https://www.pnminfotech.com",
];

const envAllowedOrigins = String(
  process.env.CORS_ALLOWED_ORIGINS ||
    process.env.ALLOWED_ORIGINS ||
    process.env.FRONTEND_ORIGIN ||
    ""
)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...DEFAULT_ALLOWED_ORIGINS, ...envAllowedOrigins])];

const corsOptions = {
  origin(origin, callback) {
    const isPrivateLanOrigin = /^https?:\/\/(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[^/]+(?::\d+)?$/i.test(
      String(origin || "")
    );
    if (
      !origin ||
      allowedOrigins.includes(origin) ||
      (process.env.NODE_ENV !== "production" && isPrivateLanOrigin)
    ) {
      return callback(null, true);
    }
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Origin",
    "X-Idempotency-Key",
    "X-Invite-Token",
    "X-Platform",
    "X-App-Version",
  ],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || "10mb" }));
app.use(express.urlencoded({ extended: true, limit: process.env.URLENCODED_BODY_LIMIT || "10mb" }));

// Static files for uploaded content (if any local)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/tenant-docs", tenantDocsRoutes);
app.use("/api/saas", saasRoutes);
app.use("/api/saas/payments", saasPaymentRoutes);
app.get("/api/phonepe/checkout/:transactionId", saasPaymentRoutes.handlePhonePeCheckoutPage);
app.post("/api/phonepe/webhook", saasPaymentRoutes.handlePhonePeWebhook);
app.all("/api/phonepe/return", (req, res) => {
  const configuredReturnUrl =
    process.env.PHONEPE_APP_RETURN_URL ||
    process.env.FRONTEND_PAYMENT_RETURN_URL ||
    "rentmanagementmobile://login";
  const returnUrl = new URL(configuredReturnUrl);
  returnUrl.searchParams.set("payment", "submitted");
  returnUrl.searchParams.set("source", "phonepe");
  if (req.query?.merchantOrderId) returnUrl.searchParams.set("merchantOrderId", req.query.merchantOrderId);
  if (req.query?.transactionId) returnUrl.searchParams.set("transactionId", req.query.transactionId);

  const target = returnUrl.toString();
  res
    .status(200)
    .send(`<!doctype html>
<html>
  <head>
    <title>Payment Submitted</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0;url=${target}" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #fff8f1; color: #111827; }
      main { max-width: 420px; padding: 28px; text-align: center; }
      a { display: inline-block; margin-top: 16px; padding: 12px 18px; border-radius: 8px; background: #7a365d; color: white; text-decoration: none; font-weight: 700; }
      p { color: #6b7280; line-height: 1.5; }
    </style>
    <script>window.location.replace(${JSON.stringify(target)});</script>
  </head>
  <body>
    <main>
      <h2>Payment submitted</h2>
      <p>Your payment response was received. Open EazyRent to confirm payment and activate your subscription.</p>
      <a href="${target}">Open EazyRent</a>
    </main>
  </body>
</html>`);
});

app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) =>
  res.sendStatus(204)
);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "dev" })
);

// Routes
app.use("/api", require("./routes/notifications"));
app.use("/api", authRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api", formRoutes);
app.use("/api", formWithDocsRoutes); // ✅ no trailing slash
app.use("/api", projectRoutes);

app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/commercial-units", commercialRoutes);
app.use("/api/light-bill", lightBillRoutes);
app.use("/api/other-expense", otherExpenseRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", require("./routes/invoices"));
app.use("/api/invites", invitesRouter);
app.use("/api/tenant/leaves", leaveRoutes);

app.use("/api/staff-expenses", require("./routes/staffExpenseRoutes"));
app.use("/api/canteen-attendance", require("./routes/canteenAttendanceRoutes"));
app.use("/api/audit-logs", auditLogRoutes);
app.use("/api/admin", adminLeaveRoutes);
app.use("/api", require("./routes/tenantAttendance"));
app.use("/api/admin", adminNotificationsRouter);

connectDB();
startSubscriptionReminderJob();
startRentReminderSmsJob();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ Health:        http://localhost:${PORT}/api/health`);
});
