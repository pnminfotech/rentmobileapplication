function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isSmsEnabled() {
  return String(process.env.SMS_ENABLED || "").toLowerCase() === "true";
}

function isPlaceholder(value) {
  return /^YOUR_/i.test(String(value || "").trim());
}

function smsProvider() {
  return String(process.env.SMS_PROVIDER || "generic").trim().toLowerCase();
}

function unitName(tenant = {}) {
  const type = String(tenant.propertyType || "bed").toLowerCase();

  if (type === "shop") return `Shop ${tenant.roomNo || ""}`.trim();
  if (type === "room") return `Room ${tenant.roomNo || ""}`.trim();

  return `Room ${tenant.roomNo || ""} Bed ${tenant.bedNo || ""}`.trim();
}

function unitNumber(tenant = {}) {
  const type = String(tenant.propertyType || "bed").toLowerCase();
  const room = String(tenant.roomNo || "").trim();
  const bed = String(tenant.bedNo || "").trim();

  if (type === "bed") return [room, bed].filter(Boolean).join("/");
  return room || unitName(tenant);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-IN");
}

function normalizeAmount(value) {
  const amount = Math.round(Number(value || 0));
  return Number.isFinite(amount) ? String(amount) : "0";
}

function smsBrandName(organization = {}) {
  return process.env.SMS_BRAND_NAME || organization.businessName || organization.name || "EazyRent";
}

function msg91Mobile(value) {
  const phone = onlyDigits(value);
  if (!/^[6-9]\d{9}$/.test(phone)) return "";
  const countryCode = onlyDigits(process.env.MSG91_COUNTRY_CODE || "91") || "91";
  return `${countryCode}${phone}`;
}

async function sendMsg91Sms({ to, templateId, variables = {} }) {
  const mobile = msg91Mobile(to);
  if (!mobile) return { sent: false, skipped: "INVALID_PHONE", phone: onlyDigits(to) };

  const authKey = process.env.MSG91_AUTH_KEY || process.env.SMS_API_KEY;
  const flowUrl = process.env.MSG91_FLOW_URL || process.env.SMS_API_URL || "https://control.msg91.com/api/v5/flow";
  if (!authKey || !templateId || isPlaceholder(authKey) || isPlaceholder(templateId)) {
    return { sent: false, skipped: "MSG91_NOT_CONFIGURED" };
  }

  const response = await fetch(flowUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      authkey: authKey,
    },
    body: JSON.stringify({
      template_id: templateId,
      short_url: "0",
      recipients: [{ mobiles: mobile, ...variables }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.type === "error") {
    throw new Error(data.message || `MSG91 SMS failed with ${response.status}`);
  }

  return { sent: true, provider: "msg91", phone: mobile, data };
}

async function sendGenericSms({ to, message, templateId, variables = {} }) {
  const phone = onlyDigits(to);
  if (!/^[6-9]\d{9}$/.test(phone)) {
    return { sent: false, skipped: "INVALID_PHONE", phone };
  }

  const apiUrl = process.env.SMS_API_URL;
  const apiKey = process.env.SMS_API_KEY;
  if (!apiUrl || !apiKey || isPlaceholder(apiUrl) || isPlaceholder(apiKey)) {
    return { sent: false, skipped: "SMS_NOT_CONFIGURED" };
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
    },
    body: JSON.stringify({
      to: phone,
      sender: process.env.SMS_SENDER_ID,
      templateId,
      message,
      variables,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `SMS failed with ${response.status}`);
  }

  return { sent: true, provider: "generic", phone, data };
}

async function sendSms({ to, message, templateId, variables = {} }) {
  if (!isSmsEnabled()) {
    const result = { sent: false, skipped: "SMS_DISABLED" };
    console.warn("[sms] skipped", result);
    return result;
  }

  const result = smsProvider() === "msg91"
    ? await sendMsg91Sms({ to, templateId, variables })
    : await sendGenericSms({ to, message, templateId, variables });

  if (!result.sent) console.warn("[sms] skipped", result);
  return result;
}

async function sendAdmissionSms(tenant = {}, organization = {}) {
  const variables = {
    name: tenant.name || "Tenant",
    number: unitNumber(tenant),
    name1: organization.businessName || organization.name || smsBrandName(organization),
    date: formatDate(tenant.joiningDate),
  };
  const message = `Dear ${variables.name}, your admission for Room ${variables.number} at ${variables.name1} is confirmed from ${variables.date}. Please note that one month notice is required before vacating. - EazyRent`;

  return sendSms({
    to: tenant.phoneNo,
    message,
    templateId: process.env.SMS_TEMPLATE_ADMISSION_ID,
    variables,
  });
}

async function sendPaymentReceivedSms({ tenant, organization, amountPaid, billingMonth, balanceDue }) {
  const variables = {
    name: tenant.name || "Tenant",
    date: billingMonth || "",
    number: normalizeAmount(amountPaid),
    number1: unitNumber(tenant),
  };
  const message = `Dear ${variables.name}, your ${variables.date} rent payment of Rs. ${variables.number} for Room ${variables.number1} has been received successfully. - EazyRent`;

  return sendSms({
    to: tenant.phoneNo,
    message,
    templateId: process.env.SMS_TEMPLATE_PAYMENT_ID,
    variables,
  });
}

async function sendRentReminderSms({ tenant, organization, amountDue, billingMonth, dueDate }) {
  const variables = {
    name: billingMonth || "monthly",
    number: normalizeAmount(amountDue),
    number1: unitNumber(tenant),
    date: formatDate(dueDate),
  };
  const message = `Dear tenant, your ${variables.name} rent of Rs. ${variables.number} for ${variables.number1} is due on ${variables.date}. Please pay by the due date. - EazyRent`;

  return sendSms({
    to: tenant.phoneNo,
    message,
    templateId: process.env.SMS_TEMPLATE_REMINDER_ID,
    variables,
  });
}

module.exports = {
  sendAdmissionSms,
  sendPaymentReceivedSms,
  sendRentReminderSms,
};
