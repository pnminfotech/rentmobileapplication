function toNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function toValidDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function firstDayOfNextMonth(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return d;
}

function firstDayOfMonth(date = new Date()) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d;
}

function startOfDayTime(date) {
  const d = toValidDate(date);
  if (!d) return 0;
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseMonthKey(month) {
  if (typeof month !== "string" || !month.trim()) return null;
  const match = month.trim().match(/^([A-Za-z]+)-(\d{2}|\d{4})$/);
  if (!match) return null;

  const m = new Date(`${match[1]} 1, 2000`).getMonth();
  if (!Number.isFinite(m) || Number.isNaN(m)) return null;

  const rawYear = Number(match[2]);
  if (!Number.isFinite(rawYear)) return null;

  return {
    y: match[2].length === 2 ? 2000 + rawYear : rawYear,
    m,
  };
}

function formatMonthKey(y, m) {
  const mon = new Date(y, m, 1).toLocaleString("en-US", { month: "short" });
  return `${mon}-${String(y).slice(-2)}`;
}

function normalizeSnapshot(entry = {}, fallbackDate = null) {
  const effectiveFrom =
    toValidDate(entry.effectiveFrom) ||
    toValidDate(entry.from) ||
    toValidDate(entry.changedAt) ||
    toValidDate(entry.date) ||
    toValidDate(fallbackDate);

  if (!effectiveFrom) return null;

  const amount = toNum(
    entry.baseRent ??
      entry.rentAmount ??
      entry.amount ??
      entry.price ??
      entry.monthlyRent
  );

  if (!amount) return null;

  return {
    effectiveFrom,
    roomNo: entry.roomNo != null ? String(entry.roomNo) : "",
    bedNo: entry.bedNo != null ? String(entry.bedNo) : "",
    baseRent: amount,
    rentAmount: amount,
    previousBaseRent: toNum(entry.previousBaseRent ?? entry.previousRentAmount),
    previousRoomNo: entry.previousRoomNo != null ? String(entry.previousRoomNo) : "",
    previousBedNo: entry.previousBedNo != null ? String(entry.previousBedNo) : "",
    source: entry.source || "history",
  };
}

function pruneConflictingFutureSnapshots(snapshots = [], tenant = {}) {
  const currentRoomNo = tenant?.roomNo != null ? String(tenant.roomNo) : "";
  const currentBedNo = tenant?.bedNo != null ? String(tenant.bedNo) : "";
  if (!currentRoomNo || !currentBedNo || !Array.isArray(snapshots) || !snapshots.length) {
    return snapshots;
  }

  let anchorIndex = -1;
  snapshots.forEach((snap, index) => {
    if (
      String(snap?.roomNo || "") === currentRoomNo &&
      String(snap?.bedNo || "") === currentBedNo
    ) {
      anchorIndex = index;
    }
  });

  if (anchorIndex === -1) return snapshots;

  return snapshots.filter((snap, index) => {
    if (index <= anchorIndex) return true;
    return (
      String(snap?.roomNo || "") === currentRoomNo &&
      String(snap?.bedNo || "") === currentBedNo
    );
  });
}

function getCurrentMonthlyRent(tenant = {}, roomsData = []) {
  if (roomsData && tenant?.roomNo && tenant?.bedNo) {
    // Room numbers can repeat across wings/buildings. Prefer the stored roomId
    // and only fall back to the location fields for older tenant records.
    const room = (tenant.roomId && roomsData.find((item) => String(item._id) === String(tenant.roomId)))
      || roomsData.find((item) =>
        String(item.roomNo) === String(tenant.roomNo)
        && (!tenant.propertyType || String(item.propertyType) === String(tenant.propertyType))
        && (!tenant.category || String(item.category || "") === String(tenant.category))
        && (!tenant.wingName || String(item.wingName || "") === String(tenant.wingName))
      )
      || roomsData.find((item) =>
        String(item.roomNo) === String(tenant.roomNo)
        && (!tenant.propertyType || String(item.propertyType) === String(tenant.propertyType))
      );
    const bed = room?.beds?.find((b) => String(b.bedNo) === String(tenant.bedNo));
    const bedRent = toNum(bed?.price) || toNum(bed?.baseRent) || toNum(bed?.monthlyRent);
    if (bedRent) return bedRent;
  }

  const currentFromTenant =
    toNum(tenant?.baseRent) ||
    toNum(tenant?.rentAmount) ||
    toNum(tenant?.rent) ||
    toNum(tenant?.expectedRent) ||
    toNum(tenant?.defaultRent) ||
    toNum(tenant?.monthlyRent);
  if (currentFromTenant) return currentFromTenant;

  return 0;
}

function getLatestPaidRentAmount(tenant = {}) {
  const paidRents = (Array.isArray(tenant.rents) ? tenant.rents : [])
    .filter((r) => toNum(r?.rentAmount) > 0)
    .map((r) => ({
      amount: toNum(r.rentAmount),
      time: (() => {
        const date = toValidDate(r.date);
        if (date) return date.getTime();
        const ym = parseMonthKey(r.month);
        return ym ? new Date(ym.y, ym.m, 1).getTime() : 0;
      })(),
    }))
    .sort((a, b) => a.time - b.time);

  return paidRents.length ? paidRents[paidRents.length - 1].amount : 0;
}

function getShiftPreservedRent(tenant = {}) {
  const history = Array.isArray(tenant.rentHistory) ? tenant.rentHistory : [];
  const hasShiftHistory = history.some((entry) => entry?.source === "shift");
  const hasShiftFlag = Boolean(
    tenant.shiftEffectiveFrom || tenant.shiftDate || tenant.effectiveFrom
  );
  const canUsePaidRent =
    hasShiftHistory ||
    hasShiftFlag ||
    String(tenant.firstRentStatus || "").trim() === "ADVANCE_PAID";

  const latestPaid = getLatestPaidRentAmount(tenant);
  const storedRent = toNum(
    tenant?.baseRent ??
      tenant?.rentAmount ??
      tenant?.rent ??
      tenant?.expectedRent ??
      tenant?.defaultRent ??
      tenant?.monthlyRent
  );

  return canUsePaidRent && latestPaid > 0 && storedRent > 0 && latestPaid < storedRent
    ? latestPaid
    : 0;
}

function getLatestShiftCutoffDate(tenant = {}) {
  const direct =
    toValidDate(tenant.shiftEffectiveFrom) ||
    toValidDate(tenant.shiftDate) ||
    toValidDate(tenant.effectiveFrom);
  if (direct) return direct;

  const history = Array.isArray(tenant.rentHistory) ? tenant.rentHistory : [];
  const latestShift = history
    .map((entry) => normalizeSnapshot(entry))
    .filter((entry) => entry && entry.source === "shift")
    .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];

  return latestShift?.effectiveFrom || null;
}

function getCycleStartForMonth(tenant = {}, y, m) {
  if (!tenant?.joiningDate) return null;

  const joinDate = toValidDate(tenant.joiningDate);
  if (!joinDate) return null;

  const firstBillYM = getFirstBillYM(tenant, joinDate);
  if (firstBillYM === null) return null;

  const cellYM = y * 12 + m;
  if (cellYM < firstBillYM) return null;

  const cycleIndex = cellYM - firstBillYM;
  const cycleStart = new Date(joinDate);
  cycleStart.setHours(0, 0, 0, 0);
  cycleStart.setMonth(cycleStart.getMonth() + cycleIndex);
  return cycleStart;
}

function getFirstBillYM(tenant = {}, joinDateValue = null) {
  const joinDate = toValidDate(joinDateValue) || toValidDate(tenant.joiningDate);
  if (!joinDate) return null;

  const isAdvance = String(tenant.firstRentStatus || "").trim() === "ADVANCE_PAID";
  const joinYM = joinDate.getFullYear() * 12 + joinDate.getMonth();

  if (!tenant.firstRentMonth) return joinYM;

  const parsed = parseMonthKey(tenant.firstRentMonth);
  if (!parsed) return null;

  const parsedYM = parsed.y * 12 + parsed.m;
  const legacyNormalPaymentMonth = !isAdvance && parsedYM === joinYM + 1;
  return legacyNormalPaymentMonth ? joinYM : parsedYM;
}

function buildRentTimeline(tenant = {}, roomsData = []) {
  const history = Array.isArray(tenant.rentHistory) ? tenant.rentHistory : [];
  const payments = Array.isArray(tenant.rents) ? tenant.rents : [];
  const snapshots = [];
  const paidRents = payments
    .filter((r) => toNum(r?.rentAmount) > 0)
    .map((r) => ({
      amount: toNum(r.rentAmount),
      ym: getPaymentMonth(r),
      date: toValidDate(r.date) || new Date(),
    }))
    .filter((r) => r.ym)
    .sort((a, b) => (a.ym.y * 12 + a.ym.m) - (b.ym.y * 12 + b.ym.m));

  history
    .map((entry) => normalizeSnapshot(entry))
    .filter(Boolean)
    .sort((a, b) => a.effectiveFrom - b.effectiveFrom)
    .forEach((snap) => snapshots.push(snap));

  const selectedShiftDate =
    toValidDate(tenant.shiftEffectiveFrom) ||
    toValidDate(tenant.shiftDate) ||
    toValidDate(tenant.effectiveFrom);
  if (selectedShiftDate) {
    selectedShiftDate.setHours(0, 0, 0, 0);
    const latestShift = snapshots
      .map((snap, index) => ({ snap, index }))
      .filter(({ snap }) => snap.source === "shift")
      .sort((a, b) => b.snap.effectiveFrom - a.snap.effectiveFrom)[0];

    if (latestShift) {
      snapshots[latestShift.index] = {
        ...snapshots[latestShift.index],
        effectiveFrom: selectedShiftDate,
      };
    }
  }

  const joinDate = toValidDate(tenant.joiningDate);
  if (snapshots.length && joinDate && snapshots[0].effectiveFrom > joinDate) {
    const first = snapshots[0];
    const paidBeforeFirstShift = paidRents
      .filter((rent) => rent.date < first.effectiveFrom)
      .sort((a, b) => b.date - a.date)[0];
    const previousAmount = toNum(first.previousBaseRent) || toNum(paidBeforeFirstShift?.amount);
    if (previousAmount > 0) {
      snapshots.unshift({
        effectiveFrom: joinDate,
        roomNo: first.previousRoomNo || "",
        bedNo: first.previousBedNo || "",
        baseRent: previousAmount,
        rentAmount: previousAmount,
        source: "previous-before-shift",
      });
    }
  }

  if (!snapshots.length) {
    const fallback = getCurrentMonthlyRent(tenant, roomsData);
    if (fallback > 0) {
      snapshots.push({
        effectiveFrom: toValidDate(tenant.joiningDate) || new Date(),
        roomNo: tenant?.roomNo != null ? String(tenant.roomNo) : "",
        bedNo: tenant?.bedNo != null ? String(tenant.bedNo) : "",
        baseRent: fallback,
        rentAmount: fallback,
        source: "current",
      });
    }
  }

  const currentAmount = getCurrentMonthlyRent(tenant, roomsData);
  const lastSnapshot = snapshots[snapshots.length - 1];
  if (currentAmount > 0 && (!lastSnapshot || toNum(lastSnapshot.baseRent) !== currentAmount)) {
    snapshots.push({
      effectiveFrom: new Date(),
      roomNo: tenant?.roomNo != null ? String(tenant.roomNo) : "",
      bedNo: tenant?.bedNo != null ? String(tenant.bedNo) : "",
      baseRent: currentAmount,
      rentAmount: currentAmount,
      source: "current",
    });
  }

  const sorted = snapshots.sort((a, b) => a.effectiveFrom - b.effectiveFrom);
  return pruneConflictingFutureSnapshots(sorted, tenant);
}

function getExpectedRentForMonth(tenant = {}, y, m, roomsData = []) {
  return getRentProrationForMonth(tenant, y, m, roomsData).expected;
}

function dayNumber(value) {
  const date = toValidDate(value);
  if (!date) return 0;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
}

function getRentProrationForMonth(tenant = {}, y, m, roomsData = []) {
  const snapshots = buildRentTimeline(tenant, roomsData);
  const fallback = getCurrentMonthlyRent(tenant, roomsData);

  const cycleStart = getCycleStartForMonth(tenant, y, m);
  if (!cycleStart) return { expected: 0, cycleStart: null, cycleEnd: null, totalDays: 0, segments: [] };

  const cycleEnd = new Date(cycleStart);
  cycleEnd.setMonth(cycleEnd.getMonth() + 1);
  const cycleStartTime = startOfDayTime(cycleStart);
  const cycleEndTime = startOfDayTime(cycleEnd);
  const totalDays = Math.max(dayNumber(cycleEnd) - dayNumber(cycleStart), 1);
  let activeRate = fallback;

  snapshots.forEach((snapshot) => {
    if (startOfDayTime(snapshot.effectiveFrom) <= cycleStartTime) {
      activeRate = toNum(snapshot.baseRent || snapshot.rentAmount) || activeRate;
    }
  });

  const changes = snapshots.filter((snapshot) => {
    const time = startOfDayTime(snapshot.effectiveFrom);
    return time > cycleStartTime && time < cycleEndTime;
  });
  const segments = [];
  let cursor = new Date(cycleStart);

  for (const change of changes) {
    const end = new Date(change.effectiveFrom);
    end.setHours(0, 0, 0, 0);
    const days = Math.max(dayNumber(end) - dayNumber(cursor), 0);
    if (days > 0) segments.push({ from: new Date(cursor), to: end, days, monthlyRate: activeRate, amount: activeRate * days / totalDays });
    cursor = end;
    activeRate = toNum(change.baseRent || change.rentAmount) || activeRate;
  }

  const remainingDays = Math.max(dayNumber(cycleEnd) - dayNumber(cursor), 0);
  if (remainingDays > 0) segments.push({ from: new Date(cursor), to: new Date(cycleEnd), days: remainingDays, monthlyRate: activeRate, amount: activeRate * remainingDays / totalDays });
  const expected = Math.round(segments.reduce((sum, segment) => sum + segment.amount, 0));
  return { expected: expected || fallback, cycleStart, cycleEnd, totalDays, segments };
}

function getRentCycleForDate(tenant = {}, value) {
  const date = toValidDate(value);
  const joiningDate = toValidDate(tenant.joiningDate);
  if (!date || !joiningDate) return null;

  const firstYM = getFirstBillYM(tenant, joiningDate);
  if (firstYM === null) return null;
  let index = (date.getFullYear() - joiningDate.getFullYear()) * 12 + date.getMonth() - joiningDate.getMonth();
  let labelYM = firstYM + index;
  let y = Math.floor(labelYM / 12);
  let m = labelYM % 12;
  let start = getCycleStartForMonth(tenant, y, m);
  if (start && date < start) {
    index -= 1; labelYM = firstYM + index; y = Math.floor(labelYM / 12); m = labelYM % 12; start = getCycleStartForMonth(tenant, y, m);
  }
  if (!start) return null;
  const end = new Date(start); end.setMonth(end.getMonth() + 1);
  return { y, m, month: formatMonthKey(y, m), cycleStart: start, cycleEnd: end };
}

function getPaymentMonth(rent = {}) {
  const fromMonth = parseMonthKey(rent.month);
  if (fromMonth) return fromMonth;

  const date = toValidDate(rent.date);
  if (!date) return null;

  return { y: date.getFullYear(), m: date.getMonth() };
}

function getPaidAmountForMonth(rents = [], y, m) {
  return (Array.isArray(rents) ? rents : []).reduce((sum, rent) => {
    const paidMonth = getPaymentMonth(rent);
    if (!paidMonth || paidMonth.y !== y || paidMonth.m !== m) return sum;
    return sum + toNum(rent?.rentAmount);
  }, 0);
}

function getUnpaidRentBeforeDate(tenant = {}, cutoffDate, roomsData = [], options = {}) {
  const includePartialCycle = Boolean(options.includePartialCycle);
  const cutoff = toValidDate(cutoffDate);
  if (!cutoff || !tenant?.joiningDate) return [];

  cutoff.setHours(23, 59, 59, 999);

  const joinDate = toValidDate(tenant.joiningDate);
  if (!joinDate) return [];

  const isAdvance = String(tenant.firstRentStatus || "").trim() === "ADVANCE_PAID";

  let cursorYM = getFirstBillYM(tenant, joinDate);
  if (cursorYM === null) return [];

  const cutoffYM = cutoff.getFullYear() * 12 + cutoff.getMonth();
  const maxYM = cutoffYM + 1;
  const unpaid = [];

  while (cursorYM <= maxYM) {
    const y = Math.floor(cursorYM / 12);
    const m = cursorYM % 12;
    const cycleStart = getCycleStartForMonth(tenant, y, m);
    if (!cycleStart) {
      cursorYM += 1;
      continue;
    }

    const cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    if (dayNumber(cycleStart) > dayNumber(cutoff)) break;

    const fullCycle = getRentProrationForMonth(tenant, y, m, roomsData);
    const isPartial = cycleEnd > cutoff;
    if (isPartial && !includePartialCycle && !isAdvance) break;
    const chargeUntil = isPartial ? new Date(cutoff) : new Date(cycleEnd);
    if (isPartial) {
      chargeUntil.setDate(chargeUntil.getDate() + 1);
      chargeUntil.setHours(0, 0, 0, 0);
    }
    const expected = isPartial && includePartialCycle
      ? Math.round((fullCycle.segments || []).reduce((sum, segment) => {
          const from = toValidDate(segment.from);
          const to = toValidDate(segment.to);
          if (!from || !to) return sum;
          const clippedFrom = dayNumber(from) < dayNumber(cycleStart) ? cycleStart : from;
          const clippedTo = dayNumber(to) > dayNumber(chargeUntil) ? chargeUntil : to;
          const days = Math.max(dayNumber(clippedTo) - dayNumber(clippedFrom), 0);
          return sum + (toNum(segment.monthlyRate) * days / Math.max(fullCycle.totalDays || 0, 1));
        }, 0))
      : fullCycle.expected;

    if (expected > 0) {
      const paid = getPaidAmountForMonth(tenant.rents, y, m);
      const outstanding = Math.max(0, expected - paid);

      if (outstanding > 0) {
        unpaid.push({
          month: formatMonthKey(y, m),
          expected,
          paid,
          outstanding,
          cycleStart,
          cycleEnd,
          chargedUntil: chargeUntil,
          chargedDays: isPartial
            ? Math.max(dayNumber(chargeUntil) - dayNumber(cycleStart), 0)
            : fullCycle.totalDays,
          totalDays: fullCycle.totalDays,
          partial: isPartial,
        });
      }
    }

    if (isPartial) break;

    cursorYM += 1;
  }

  return unpaid;
}

function getRentCyclesBetweenDates(tenant = {}, startValue, endValue, roomsData = []) {
  const start = toValidDate(startValue);
  const end = toValidDate(endValue);
  const joinDate = toValidDate(tenant.joiningDate);
  if (!start || !end || !joinDate || start > end) return [];
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  let cursorYM = getFirstBillYM(tenant, joinDate);
  if (cursorYM === null) return [];
  const maxYM = end.getFullYear() * 12 + end.getMonth() + 2;
  const cycles = [];

  while (cursorYM <= maxYM) {
    const y = Math.floor(cursorYM / 12);
    const m = cursorYM % 12;
    const cycleStart = getCycleStartForMonth(tenant, y, m);
    if (!cycleStart) { cursorYM += 1; continue; }
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);
    if (cycleEnd > end) break;
    if (cycleEnd >= start) {
      const expected = getExpectedRentForMonth(tenant, y, m, roomsData);
      const paid = getPaidAmountForMonth(tenant.rents, y, m);
      cycles.push({ month: formatMonthKey(y, m), cycleStart, cycleEnd, expected, paid, pending: Math.max(expected - paid, 0) });
    }
    cursorYM += 1;
  }
  return cycles;
}

function getPaymentsBetweenDates(tenant = {}, startValue, endValue) {
  const start = toValidDate(startValue);
  const end = toValidDate(endValue);
  if (!start || !end || start > end) return [];
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  const transactions = [];
  (Array.isArray(tenant.rents) ? tenant.rents : []).forEach((rent) => {
    const payments = Array.isArray(rent.payments) && rent.payments.length
      ? rent.payments
      : [{ amount: rent.rentAmount, date: rent.date, paymentMode: rent.paymentMode, utr: rent.utr, note: rent.note }];
    payments.forEach((payment) => {
      const date = toValidDate(payment.date);
      if (date && date >= start && date <= end) transactions.push({ month: rent.month, amount: toNum(payment.amount), date, paymentMode: payment.paymentMode || "Cash", utr: payment.utr || "", note: payment.note || "" });
    });
  });
  return transactions;
}

function appendRentHistorySnapshot(existing = {}, incoming = {}) {
  const trackedKeys = ["roomNo", "bedNo", "baseRent", "rentAmount"];
  const hasShiftLikeChange = trackedKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(incoming, key) &&
    String(incoming[key] ?? "") !== String(existing[key] ?? "")
  );

  if (!hasShiftLikeChange) return {};

  const mergedTenant = { ...existing, ...incoming };
  const amount =
    toNum(incoming.baseRent) ||
    toNum(incoming.rentAmount) ||
    getCurrentMonthlyRent(mergedTenant) ||
    getLatestPaidRentAmount(existing);
  if (!amount) return {};

  const history = Array.isArray(existing.rentHistory) ? [...existing.rentHistory] : [];
  const last = history[history.length - 1];
  const requestedStart =
    toValidDate(incoming.shiftEffectiveFrom) ||
    toValidDate(incoming.shiftDate) ||
    toValidDate(incoming.effectiveFrom) ||
    new Date();
  requestedStart.setHours(0, 0, 0, 0);
  const previousAmount =
    getCurrentMonthlyRent(existing) || getLatestPaidRentAmount(existing);

  if (!history.length && previousAmount > 0) {
    history.push({
      effectiveFrom: toValidDate(existing.joiningDate) || toValidDate(existing.createdAt) || new Date(),
      roomNo: existing.roomNo != null ? String(existing.roomNo) : "",
      bedNo: existing.bedNo != null ? String(existing.bedNo) : "",
      baseRent: previousAmount,
      rentAmount: previousAmount,
      source: "initial-before-shift",
    });
  }

  const nextSnapshot = {
    effectiveFrom: requestedStart,
    roomNo: incoming.roomNo != null ? String(incoming.roomNo) : String(existing.roomNo || ""),
    bedNo: incoming.bedNo != null ? String(incoming.bedNo) : String(existing.bedNo || ""),
    baseRent: amount,
    rentAmount: amount,
    previousRoomNo: existing.roomNo != null ? String(existing.roomNo) : "",
    previousBedNo: existing.bedNo != null ? String(existing.bedNo) : "",
    previousBaseRent: previousAmount,
    previousRentAmount: previousAmount,
    source: "shift",
  };

  if (
    last &&
    String(last.roomNo || "") === String(nextSnapshot.roomNo || "") &&
    String(last.bedNo || "") === String(nextSnapshot.bedNo || "") &&
    toNum(last.baseRent || last.rentAmount) === amount
  ) {
    return {};
  }

  history.push(nextSnapshot);
  return { rentHistory: history };
}

module.exports = {
  appendRentHistorySnapshot,
  buildRentTimeline,
  getExpectedRentForMonth,
  getRentProrationForMonth,
  getRentCycleForDate,
  getPaidAmountForMonth,
  parseMonthKey,
  getCurrentMonthlyRent,
  getCycleStartForMonth,
  getFirstBillYM,
  getUnpaidRentBeforeDate,
  getRentCyclesBetweenDates,
  getPaymentsBetweenDates,
  firstDayOfMonth,
  firstDayOfNextMonth,
};
