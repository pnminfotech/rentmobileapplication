const express = require("express");
const { requireSystemAuth } = require("../middleware/saasAuth");
const rentHistoryHelpers = require("./_helpers/rentHistory");
const {
  catalogResponse,
  contextualQuestions,
} = require("../config/assistantQuestions");

const Form = require("../models/formModels");
const Room = require("../models/Room");
const StaffExpense = require("../models/StaffExpense");
const OtherExpense = require("../models/OtherExpense");
const LightBillEntry = require("../models/LightBillEntry");
const LeaveRequest = require("../models/LeaveRequest");
const Invoice = require("../models/Invoice");
const Payment = require("../models/Payment");
const WalletLedger = require("../models/WalletLedger");
const CanteenAttendance = require("../models/CanteenAttendance");
const {
  getExpectedRentForMonth,
  getPaidAmountForMonth,
  getRentCycleForDate,
  getUnpaidRentBeforeDate,
} = rentHistoryHelpers;

const router = express.Router();
const UNKNOWN_ANSWER = "I don't have enough verified data to answer that.";

// ---- Helpers copied from your UI so answers match exactly ----
const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

const expectFromTenant = (tenant, roomsData) => {
  const v =
    toNum(tenant?.baseRent) ||
    toNum(tenant?.rent) ||
    toNum(tenant?.rentAmount) ||
    toNum(tenant?.expectedRent) ||
    toNum(tenant?.defaultRent) ||
    toNum(tenant?.monthlyRent) ||
    toNum(tenant?.price) ||
    toNum(tenant?.bedPrice);

  if (v) return v;

  if (roomsData && tenant?.roomNo && tenant?.bedNo) {
    const room = (tenant.roomId && roomsData.find(r => String(r.id) === String(tenant.roomId)))
      || roomsData.find(r =>
        String(r.roomNo) === String(tenant.roomNo) &&
        String(r.propertyType || "bed") === String(tenant.propertyType || "bed") &&
        String(r.category || "") === String(tenant.category || "") &&
        String(r.wingName || "") === String(tenant.wingName || "")
      );
    const bed  = room?.beds?.find(b => String(b.bedNo) === String(tenant.bedNo));
    return (
      toNum(bed?.price) ||
      toNum(bed?.baseRent) ||
      toNum(bed?.monthlyRent) ||
      0
    );
  }
  return 0;
};

const calculateDue = (rents = [], joiningDateStr, tenant = {}, roomsData = []) => {
  if (!joiningDateStr) return 0;
  const now = new Date();
  const currentYear = now.getFullYear();
  const startOfYear = new Date(currentYear, 0, 1);
  const joinDate = new Date(joiningDateStr);
  const rentStart = new Date(joinDate.getFullYear(), joinDate.getMonth() + 1, 1);
  const startDate = rentStart > startOfYear ? rentStart : startOfYear;

  const tempDate = new Date(startDate);
  const paidMonths = new Set(
    rents
      .filter(r => r.date && Number(r.rentAmount) > 0)
      .map(r => {
        const d = new Date(r.date);
        return `${d.getMonth()}-${d.getFullYear()}`;
      })
  );

  let dueCount = 0;
  while (tempDate <= now && tempDate.getFullYear() === currentYear) {
    const key = `${tempDate.getMonth()}-${tempDate.getFullYear()}`;
    if (!paidMonths.has(key)) {
      dueCount += getExpectedRentForMonth(tenant, tempDate.getFullYear(), tempDate.getMonth(), roomsData);
    }
    tempDate.setMonth(tempDate.getMonth() + 1);
  }
  return dueCount;
};

const getPendingMonthsForStatus = (rents = [], joiningDateStr) => {
  if (!joiningDateStr) return [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const paidMonths = new Set(
    rents
      .filter(r => r.date && Number(r.rentAmount) > 0)
      .map(r => {
        const d = new Date(r.date);
        return `${d.getMonth()}-${d.getFullYear()}`;
      })
  );

  const months = [];
  const startMonth = new Date(currentYear, 0);
  const joinDate = new Date(joiningDateStr);
  const startDate = joinDate > startMonth ? joinDate : startMonth;
  const tempDate = new Date(startDate);

  while (tempDate <= now) {
    const key = `${tempDate.getMonth()}-${tempDate.getFullYear()}`;
    if (!paidMonths.has(key)) {
      months.push(tempDate.toLocaleString('default', { month: 'long', year: 'numeric' }));
    }
    tempDate.setMonth(tempDate.getMonth() + 1);
  }
  return months;
};

const money = (value) => `₹${toNum(value).toLocaleString("en-IN")}`;

function localAnswer(question, facts) {
  const normalized = question.trim().toLowerCase()
    .replace(/panding|pendig|pnding/g, "pending")
    .replace(/tenent|tanent/g, "tenant")
    .replace(/vaccant|vacanty/g, "vacant")
    .replace(/diposit|deposite/g, "deposit")
    .replace(/cantin/g, "canteen")
    .replace(/\b(rum|रुम)\b/g, "room");
  if (/^(hi|hii|hello|hey|namaste)\b/.test(normalized)) {
    return "Hello. Ask me about tenants, pending rent, paid rent, vacancies, or totals.";
  }

  if (/(show|list|give|what).*(question|ask|support|can you)|help|सवाल|प्रश्न|प्रश्नांची यादी|सभी सवाल/.test(normalized)) {
    return catalogResponse().map((category) => {
      const english = category.questions.en.join(" | ");
      const hindi = category.questions.hi.join(" | ");
      const marathi = category.questions.mr.join(" | ");
      return `${category.label.en}:\nEN: ${english}\nHI: ${hindi}\nMR: ${marathi}`;
    }).join("\n\n");
  }

  const tenants = facts.tenants || [];
  const pending = tenants.filter((tenant) => tenant.status === "Pending");
  const paid = tenants.filter((tenant) => tenant.status === "Paid");
  const totalDue = pending.reduce((sum, tenant) => sum + tenant.dueAmount, 0);
  const totalPaid = tenants.reduce((sum, tenant) => sum + tenant.totalPaid, 0);
  const mentionedTenant = tenants.some((tenant) => {
    const name = String(tenant.name || "").trim().toLowerCase();
    return name && normalized.includes(name);
  });
  const asksPending = /(pending|overdue|due|outstanding|बाकी|baki|rahilay|भरला नाही)/.test(normalized);
  const asksVacant = /(vacan|empty|available|खाली)/.test(normalized);
  const asksPaid = /(paid|received|collected|payment|bharla|भुगतान|जमा)/.test(normalized);
  const asksTenant = /(tenant|resident|customer|person|who is|details|kon ahe|कोण|कोण आहे|कौन)/.test(normalized)
    || mentionedTenant
    || /\b(room|bed)\s*[a-z0-9-]+/i.test(normalized)
    || /^\s*[a-z]?\d+\s+(kon|kaun|who)/i.test(normalized);
  const asksCount = /(how many|count|number|total|कितने|कितनी)/.test(normalized);
  const asksAll = /(all|every|list|सभी|सब|सर्व)/.test(normalized);
  const asksUnits = /(unit|units|room|rooms|bed|beds|shop|shops|property|building|wing|floor|युनिट|कमरा|रूम|बेड|दुकान)/.test(normalized);
  const asksStaffExpense = /(staff|salary|salaries|employee|security|cleaning|cleaning lady|maushi|पगार|स्टाफ|सैलरी)/.test(normalized);

  if (asksStaffExpense) {
    let expenses = facts.staffExpenses || [];
    const now = new Date();
    if (/(this month|या महिन्यात|इस महीने|aaj|today)/.test(normalized)) {
      expenses = expenses.filter((expense) => {
        const date = new Date(expense.date);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      });
    }
    if (/(last month|मागच्या महिन्यात|पिछले महीने)/.test(normalized)) {
      const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      expenses = expenses.filter((expense) => {
        const date = new Date(expense.date);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      });
    }
    if (/salary|पगार|सैलरी/.test(normalized)) expenses = expenses.filter((expense) => /salary|employee/i.test(`${expense.type} ${expense.name}`));
    if (/security/.test(normalized)) expenses = expenses.filter((expense) => /security/i.test(`${expense.type} ${expense.name}`));
    if (/maintenance|repair|दुरुस्ती/.test(normalized)) expenses = expenses.filter((expense) => /maintenance|repair/i.test(`${expense.type} ${expense.name}`));
    if (/pending|बाकी|प्रलंबित/.test(normalized)) expenses = expenses.filter((expense) => expense.status === "pending");
    if (/paid|जमा|भुगतान/.test(normalized)) expenses = expenses.filter((expense) => expense.status === "paid");
    const total = expenses.reduce((sum, expense) => sum + toNum(expense.amount), 0);
    if (!expenses.length) return "No matching staff expenses are present in the verified data.";
    if (asksCount || /total|how much|कितना|किती/.test(normalized)) return `Staff expenses: ${expenses.length}\nTotal: ${money(total)}`;
    return `Staff expenses (${expenses.length}):\n${expenses.slice(0, 50).map((expense) => `- ${expense.name} (${expense.type}): ${money(expense.amount)} - ${expense.status}`).join("\n")}`;
  }

  const asksGeneralExpense = /(expense|expenses|cost|repair|supplies|other expense|खर्च|दुरुस्ती|साहित्य)/.test(normalized);
  if (asksGeneralExpense) {
    let expenses = facts.otherExpenses || [];
    const now = new Date();
    if (/(this month|या महिन्यात|इस महीने|aaj|today)/.test(normalized)) {
      expenses = expenses.filter((expense) => {
        const date = new Date(expense.date);
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      });
    }
    if (/(last month|मागच्या महिन्यात|पिछले महीने)/.test(normalized)) {
      const month = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      expenses = expenses.filter((expense) => {
        const date = new Date(expense.date);
        return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
      });
    }
    if (/pending|बाकी|प्रलंबित/.test(normalized)) expenses = expenses.filter((expense) => expense.status === "pending");
    if (/paid|जमा|भुगतान/.test(normalized)) expenses = expenses.filter((expense) => expense.status === "paid");
    const total = expenses.reduce((sum, expense) => sum + toNum(expense.amount), 0);
    if (!expenses.length) return "No matching general expenses are present in the verified data.";
    if (asksCount || /total|how much|कितना|किती/.test(normalized)) return `General expenses: ${expenses.length}\nTotal: ${money(total)}`;
    return `General expenses (${expenses.length}):\n${expenses.slice(0, 50).map((expense) => `- ${expense.label}: ${money(expense.amount)} - ${expense.status}`).join("\n")}`;
  }

  if (/(light bill|electricity|meter|वीज|बिजली|लाइट)/.test(normalized)) {
    let bills = facts.lightBills || [];
    if (/pending|बाकी|due|unpaid/.test(normalized)) bills = bills.filter((bill) => bill.status === "pending");
    const total = bills.reduce((sum, bill) => sum + toNum(bill.amount), 0);
    if (asksCount || /total|how much|कितना|किती/.test(normalized)) return `Light bills: ${bills.length}\nTotal: ${money(total)}`;
    if (!bills.length) return "No matching light bills are present in the verified data.";
    return `Light bills (${bills.length}):\n${bills.slice(0, 50).map((bill) => `- ${bill.label}: ${money(bill.amount)} - ${bill.status}`).join("\n")}`;
  }

  if (/(leave|leaving|checkout|former|restore|सोड|निघून|छोड़)/.test(normalized)) {
    const leaves = facts.leaveRequests || [];
    if (!leaves.length) return "No leave requests are present in the verified data.";
    return `Leave requests (${leaves.length}):\n${leaves.slice(0, 30).map((leave) => `- ${leave.tenantName || "Tenant"}: ${leave.status}, leave date ${leave.leaveDate || "-"}`).join("\n")}`;
  }

  if (/(invoice|bill|billing|इनवॉइस)/.test(normalized)) {
    const invoices = facts.invoices || [];
    const open = invoices.filter((invoice) => invoice.status === "open" || invoice.status === "partial");
    const total = open.reduce((sum, invoice) => sum + toNum(invoice.amount), 0);
    if (asksCount || /total|how much|कितना|किती/.test(normalized)) return `Invoices: ${invoices.length}\nOpen invoice amount: ${money(total)}`;
    if (!invoices.length) return "No invoices are present in the verified data.";
    return `Invoices (${invoices.length}):\n${invoices.slice(0, 40).map((invoice) => `- ${invoice.period}: ${money(invoice.amount)} - ${invoice.status}`).join("\n")}`;
  }

  if (/(wallet|coin|coins|referral|वॉलेट|कॉइन|रेफरल)/.test(normalized)) {
    const entries = facts.walletEntries || [];
    const latest = entries[0];
    const credits = entries.filter((entry) => entry.direction === "credit").reduce((sum, entry) => sum + toNum(entry.coins), 0);
    const debits = entries.filter((entry) => entry.direction === "debit").reduce((sum, entry) => sum + toNum(entry.coins), 0);
    return `Wallet balance: ${latest?.balanceAfter || 0} coins\nEarned: ${credits} coins\nUsed: ${debits} coins`;
  }

  if (/(canteen|attendance|breakfast|lunch|dinner|उपस्थिती|कैंटीन)/.test(normalized)) {
    const attendance = facts.attendance || [];
    const present = attendance.filter((entry) => entry.status === "present").length;
    const absent = attendance.filter((entry) => entry.status === "absent").length;
    return `Canteen attendance records: ${attendance.length}\nPresent: ${present}\nAbsent: ${absent}`;
  }

  if (/(reported payment|online payment|payment report|पेमेंट रिपोर्ट)/.test(normalized)) {
    const payments = facts.paymentReports || [];
    const pendingPayments = payments.filter((payment) => payment.status === "reported").length;
    const total = payments.filter((payment) => payment.status !== "rejected").reduce((sum, payment) => sum + toNum(payment.amount), 0);
    return `Payment reports: ${payments.length}\nPending confirmation: ${pendingPayments}\nReported amount: ${money(total)}`;
  }

  if (asksUnits && (asksAll || asksCount || /occupied|vacan|empty|available|details/.test(normalized))) {
    const requestedType = /shop|दुकान/.test(normalized) ? "shop"
      : /bed|बेड/.test(normalized) ? "bed"
        : /room|rooms|कमरा|रूम/.test(normalized) ? "room" : null;
    const units = (facts.units || []).filter((unit) => !requestedType || unit.propertyType === requestedType);
    if (/occupied/.test(normalized) && asksCount) {
      return `Occupied ${requestedType || "units"}: ${units.filter((unit) => unit.occupied).length}`;
    }
    if (asksVacant || /available|empty|खाली/.test(normalized)) {
      const available = units.filter((unit) => !unit.occupied);
      if (!available.length) return "There are no available units in the verified data.";
      return `Available units (${available.length}):\n${available.slice(0, 50).map((unit) => `- ${unit.label}${unit.price ? ` (${money(unit.price)})` : ""}`).join("\n")}`;
    }
    if (!units.length) return "No matching units are present in the verified data.";
    return `All units (${units.length}):\n${units.slice(0, 50).map((unit) => `- ${unit.label}${unit.occupied ? " - occupied" : " - available"}`).join("\n")}`;
  }

  if (asksVacant) {
    if (!facts.vacant.length) return "There are no vacant units in the verified data.";
    return `Vacant units (${facts.vacant.length}):\n${facts.vacant.slice(0, 30).map((unit) => `- Room ${unit.roomNo}, bed ${unit.bedNo} (${money(unit.price)})`).join("\n")}`;
  }
  if (asksPending) {
    if (asksCount || !asksTenant) return `Pending tenants: ${pending.length}\nTotal pending rent: ${money(totalDue)}`;
    if (!pending.length) return "No tenants have pending rent in the verified data.";
    return `Pending tenants (${pending.length}):\n${pending.slice(0, 30).map((tenant) => `- ${tenant.name || "Unnamed tenant"}: ${money(tenant.dueAmount)}${tenant.roomNo ? `, room ${tenant.roomNo}` : ""}`).join("\n")}`;
  }
  if (asksPaid) {
    if (asksCount || !asksTenant) return `Paid tenants: ${paid.length}\nTotal recorded rent paid: ${money(totalPaid)}`;
    if (!paid.length) return "No paid tenants are present in the verified data.";
    return `Paid tenants (${paid.length}):\n${paid.slice(0, 30).map((tenant) => `- ${tenant.name || "Unnamed tenant"}`).join("\n")}`;
  }
  if (asksAll && asksTenant) {
    if (!tenants.length) return "No tenants are present in the verified data.";
    return `All tenants (${tenants.length}):\n${tenants.slice(0, 50).map((tenant) => `- ${tenant.name || "Unnamed tenant"}: room ${tenant.roomNo || "-"}, bed ${tenant.bedNo || "-"}, status ${tenant.status}, due ${money(tenant.dueAmount)}`).join("\n")}`;
  }
  if (asksTenant) {
    const roomMatch = normalized.match(/(?:room|रूम)\s*([a-z0-9-]+)/i);
    const bedMatch = normalized.match(/(?:bed|बेड)\s*([a-z0-9-]+)/i);
    const bareUnitMatch = normalized.match(/^\s*([a-z]?\d+)\s+(?:kon|kaun|who)/i);
    const requestedRoom = roomMatch?.[1] || bareUnitMatch?.[1];
    const requestedBed = bedMatch?.[1];
    const matches = tenants.filter((tenant) => {
      if (requestedRoom && String(tenant.roomNo).toLowerCase() !== requestedRoom.toLowerCase()) return false;
      if (requestedBed && String(tenant.bedNo).toLowerCase() !== requestedBed.toLowerCase()) return false;
      if (mentionedTenant) return normalized.includes(String(tenant.name || "").trim().toLowerCase());
      const searchable = `${tenant.name} ${tenant.phoneNo} ${tenant.roomNo} ${tenant.bedNo}`.toLowerCase();
      return normalized.split(/\s+/).some((word) => word.length > 2 && searchable.includes(word));
    });
    if (!matches.length) return UNKNOWN_ANSWER;
    return matches.slice(0, 10).map((tenant) => {
      if (/(deposit|डिपॉझिट|जमा राशि)/.test(normalized)) return `- ${tenant.name}: deposit ${money(tenant.depositAmount)}`;
      if (/(mobile|phone|number|नंबर|मोबाइल)/.test(normalized)) return `- ${tenant.name}: ${tenant.phoneNo || "No phone number recorded"}`;
      if (/(rent|भाडे|किराया)/.test(normalized)) return `- ${tenant.name}: status ${tenant.status}, due ${money(tenant.dueAmount)}, monthly rent ${money(tenant.baseRent)}, pending months ${tenant.pendingMonths.join(", ") || "none"}`;
      return `- ${tenant.name || "Unnamed tenant"}: room ${tenant.roomNo || "-"}, bed ${tenant.bedNo || "-"}, status ${tenant.status}, due ${money(tenant.dueAmount)}`;
    }).join("\n");
  }
  if (asksCount || /summary|overview|dashboard/.test(normalized)) {
    return `Verified system summary:\n- Tenants: ${tenants.length}\n- Paid tenants: ${paid.length}\n- Pending rent tenants: ${pending.length}\n- Units: ${(facts.units || []).length}\n- Available units: ${(facts.units || []).filter((unit) => !unit.occupied).length}\n- Pending rent: ${money(totalDue)}\n- Recorded rent paid: ${money(totalPaid)}\n- Staff expenses: ${(facts.staffExpenses || []).length}\n- General expenses: ${(facts.otherExpenses || []).length}\n- Light bills: ${(facts.lightBills || []).length}\n- Leave requests: ${(facts.leaveRequests || []).length}\n- Invoices: ${(facts.invoices || []).length}`;
  }
  return UNKNOWN_ANSWER;
}

// Build compact “facts” for the LLM (avoid sending whole DB if huge)
function makeFacts({ tenants, rooms, staffExpenses = [], otherExpenses = [], lightBills = [], leaveRequests = [], invoices = [], walletEntries = [], attendance = [], paymentReports = [] }) {
  const roomsData = rooms.map(r => ({
    id: r._id?.toString?.() || "",
    propertyType: r.propertyType || "bed",
    category: r.category || "",
    wingName: r.wingName || "",
    roomNo: String(r.roomNo),
    floorNo: r.floorNo,
    beds: (r.beds || []).map(b => ({
      bedNo: String(b.bedNo),
      price: toNum(b.price),
      category: b.category || ""
    }))
  }));

  const facts = tenants.map(t => {
    const dueMonths = getUnpaidRentBeforeDate(t, new Date(), rooms);
    const activeCycle = getRentCycleForDate(t, new Date());
    if (activeCycle && activeCycle.cycleStart <= new Date() && !dueMonths.some((month) => month.month === activeCycle.month)) {
      const expected = getExpectedRentForMonth(t, activeCycle.y, activeCycle.m, rooms);
      const paid = getPaidAmountForMonth(t.rents || [], activeCycle.y, activeCycle.m);
      if (expected > paid) {
        dueMonths.push({ month: activeCycle.month, expected, paid, outstanding: expected - paid, cycleStart: activeCycle.cycleStart, cycleEnd: activeCycle.cycleEnd });
      }
    }
    const due = dueMonths.reduce((sum, month) => sum + toNum(month.outstanding), 0);
    const pendingMonths = dueMonths.map((month) => month.month);
    const lastPaid = (t.rents || [])
      .filter(r => r.date && Number(r.rentAmount) > 0)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

    return {
      id: t._id?.toString?.() || "",
      name: t.name || "",
      phoneNo: t.phoneNo || "",
      roomNo: String(t.roomNo || ""),
      bedNo: String(t.bedNo || ""),
      roomId: String(t.roomId || ""),
      propertyType: t.propertyType || "bed",
      category: t.category || "",
      wingName: t.wingName || "",
      depositAmount: toNum(t.depositAmount || 0),
      joiningDate: t.joiningDate ? new Date(t.joiningDate).toISOString().slice(0, 10) : null,
      leaveDate: t.leaveDate ? new Date(t.leaveDate).toISOString().slice(0, 10) : null,
      baseRent: expectFromTenant(t, roomsData),
      dueAmount: due,
      pendingMonths,
      lastPayment: lastPaid
        ? { amount: toNum(lastPaid.rentAmount), date: new Date(lastPaid.date).toISOString().slice(0, 10) }
        : null,
      totalPaid: (t.rents || []).reduce((sum, rent) => sum + toNum(rent.rentAmount), 0),
      status: due > 0 ? "Pending" : "Paid",
    };
  });

  const vacant = [];
  roomsData.forEach(r => {
    (r.beds || []).forEach(b => {
      const taken = tenants.some(
        t =>
          ((t.roomId && String(t.roomId) === r.id) ||
            (!t.roomId &&
              String(t.roomNo) === r.roomNo &&
              String(t.propertyType || "bed") === String(r.propertyType || "bed") &&
              String(t.category || "") === String(r.category || "") &&
              String(t.wingName || "") === String(r.wingName || ""))) &&
          String(t.bedNo) === b.bedNo &&
          !t.leaveDate
      );
      if (!taken) {
        vacant.push({
          roomNo: r.roomNo,
          bedNo: b.bedNo,
          price: b.price,
          category: b.category,
        });
      }
    });
  });

  const units = roomsData.flatMap((room) => {
    const roomTenants = tenants.filter((tenant) => (
      ((tenant.roomId && String(tenant.roomId) === room.id) ||
        (!tenant.roomId && String(tenant.roomNo || "") === room.roomNo && String(tenant.category || "") === room.category && String(tenant.wingName || "") === room.wingName)) &&
      !tenant.leaveDate
    ));
    if (room.propertyType === "bed") {
      return room.beds.map((bed) => ({
        propertyType: "bed",
        label: `Room ${room.roomNo}, bed ${bed.bedNo}${room.wingName ? `, ${room.wingName}` : ""}`,
        price: bed.price,
        occupied: roomTenants.some((tenant) => String(tenant.bedNo || "") === bed.bedNo),
      }));
    }
    return [{
      propertyType: room.propertyType,
      label: `${room.propertyType === "shop" ? "Shop" : "Room"} ${room.roomNo}${room.category ? `, ${room.category}` : ""}`,
      price: room.beds[0]?.price || 0,
      occupied: roomTenants.length > 0,
    }];
  });

  return {
    tenants: facts,
    vacant,
    units,
    staffExpenses: staffExpenses.map((expense) => ({
      type: expense.type || "Other",
      name: expense.name || "Unnamed staff",
      amount: toNum(expense.amount),
      status: expense.status || "pending",
      date: expense.date || null,
      notes: expense.notes || "",
    })),
    otherExpenses: otherExpenses.map((expense) => ({
      label: Array.isArray(expense.expenses) && expense.expenses.length ? expense.expenses.join(", ") : "Other expense",
      amount: toNum(expense.mainAmount),
      status: expense.status || "pending",
      date: expense.date || null,
    })),
    lightBills: lightBills.map((bill) => ({
      label: bill.name || bill.customLabel || `Room ${bill.roomNo || "-"}`,
      amount: toNum(bill.amount || bill.salary),
      status: bill.status || "pending",
      date: bill.date || null,
    })),
    leaveRequests: leaveRequests.map((leave) => ({
      tenantName: leave.tenantName || "Tenant",
      status: leave.status || "pending",
      leaveDate: leave.leaveDate || null,
    })),
    invoices: invoices.map((invoice) => ({
      period: invoice.period || "",
      amount: toNum(invoice.amount),
      status: invoice.status || "open",
    })),
    walletEntries: walletEntries.map((entry) => ({
      direction: entry.direction,
      coins: toNum(entry.coins),
      balanceAfter: toNum(entry.balanceAfter),
      description: entry.description || "",
    })),
    attendance: attendance.map((entry) => ({ status: entry.status, meal: entry.meal, dateKey: entry.dateKey })),
    paymentReports: paymentReports.map((payment) => ({ amount: payment.amount, status: payment.status, paymentMode: payment.paymentMode })),
  };
}


router.post("/ask", requireSystemAuth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Provide a 'question' string" });
    }
    const isSuperadmin = req.systemUser?.role === "superadmin";
    if (!isSuperadmin && req.systemUser?.role !== "system_admin") {
      return res.status(403).json({ error: "Assistant is available only to admins." });
    }

    const organizationFilter = isSuperadmin ? {} : { organizationId: req.organizationId };

    const [tenants, rooms, staffExpenses, otherExpenses, lightBills, leaveRequests, invoices, walletEntries, attendance, paymentReports] = await Promise.all([
      Form.find(organizationFilter, {
        name: 1, phoneNo: 1, propertyType: 1, roomId: 1, category: 1, wingName: 1, roomNo: 1, bedNo: 1, depositAmount: 1,
        joiningDate: 1, leaveDate: 1, baseRent: 1, rents: 1
      }).lean(),
      Room.find(organizationFilter, { propertyType: 1, category: 1, wingName: 1, roomNo: 1, floorNo: 1, beds: 1 }).lean(),
      StaffExpense.find(organizationFilter, { type: 1, name: 1, amount: 1, status: 1, date: 1, notes: 1 }).sort({ date: -1 }).lean(),
      OtherExpense.find(organizationFilter, { expenses: 1, mainAmount: 1, status: 1, date: 1 }).sort({ date: -1 }).lean(),
      LightBillEntry.find(organizationFilter, { name: 1, customLabel: 1, roomNo: 1, amount: 1, salary: 1, status: 1, date: 1 }).sort({ date: -1 }).lean(),
      LeaveRequest.find(organizationFilter, { tenantName: 1, status: 1, leaveDate: 1 }).sort({ leaveDate: 1 }).lean(),
      Invoice.find(organizationFilter, { period: 1, amount: 1, status: 1 }).sort({ period: -1 }).lean(),
      WalletLedger.find(organizationFilter, { direction: 1, coins: 1, balanceAfter: 1, description: 1 }).sort({ createdAt: -1 }).limit(100).lean(),
      CanteenAttendance.find(organizationFilter, { status: 1, meal: 1, dateKey: 1 }).sort({ dateKey: -1 }).limit(500).lean(),
      Payment.find(organizationFilter, { amount: 1, status: 1, paymentMode: 1 }).sort({ createdAt: -1 }).limit(200).lean(),
    ]);

    const world = makeFacts({ tenants, rooms, staffExpenses, otherExpenses, lightBills, leaveRequests, invoices, walletEntries, attendance, paymentReports });

    res.json({
      answer: localAnswer(question, world),
      suggestions: contextualQuestions(question),
      source: "local-verified-data",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Assistant failed. Check logs." });
  }
});

router.get("/questions", requireSystemAuth, (_req, res) => {
  res.json({ categories: catalogResponse(), source: "local-question-catalog" });
});

module.exports = router;
