const AuditLog = require("../models/AuditLog");

function auditActor(req) {
  const actor = req.systemUser || req.admin || {};
  return {
    actorId: String(actor._id || actor.id || ""),
    actorName: actor.name || actor.ownerName || actor.email || "Admin",
    actorEmail: actor.email || "",
    actorRole: actor.role || (actor.isAdmin ? "admin" : ""),
  };
}

function actorName(req) {
  return auditActor(req).actorName;
}

function cleanRecord(record) {
  if (!record) return null;
  if (typeof record.toObject === "function") return record.toObject();
  return { ...record };
}

function comparable(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === "object") {
    if (value._id) return String(value._id);
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = comparable(value[key]);
      return result;
    }, {});
  }
  return value ?? "";
}

function sameValue(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function diffRecords(before, after, fields) {
  const previous = cleanRecord(before) || {};
  const next = cleanRecord(after) || {};
  return fields.reduce((changes, field) => {
    if (!sameValue(previous[field], next[field])) {
      changes[field] = { before: previous[field] ?? "", after: next[field] ?? "" };
    }
    return changes;
  }, {});
}

async function writeAuditLog(req, { entityType, entityId, action, before, after, changes = {}, reason = "" }) {
  const payload = {
    ...(req.organizationId ? { organizationId: req.organizationId } : {}),
    entityType,
    entityId,
    action,
    ...auditActor(req),
    reason,
    changes,
    before: cleanRecord(before),
    after: cleanRecord(after),
  };
  return AuditLog.create(payload);
}

module.exports = {
  actorName,
  diffRecords,
  writeAuditLog,
};
