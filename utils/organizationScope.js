function hasOrganizationScope(req) {
  return Boolean(req?.organizationId);
}

function scopedQuery(req, query = {}) {
  if (!hasOrganizationScope(req)) return { ...query };
  return { ...query, organizationId: req.organizationId };
}

function scopedCreate(req, payload = {}) {
  if (!hasOrganizationScope(req)) return { ...payload };
  return { ...payload, organizationId: req.organizationId };
}

function scopedUpdate(req, update = {}) {
  if (!hasOrganizationScope(req)) return { ...update };

  const clean = { ...update };
  delete clean.organizationId;
  return clean;
}

function isScopedDocument(req, doc) {
  if (!hasOrganizationScope(req)) return true;
  return String(doc?.organizationId || "") === String(req.organizationId);
}

function ensureScopedDocument(req, doc, res, message = "Resource not found") {
  if (!doc) {
    res.status(404).json({ message });
    return false;
  }
  if (!isScopedDocument(req, doc)) {
    res.status(404).json({ message });
    return false;
  }
  return true;
}

module.exports = {
  hasOrganizationScope,
  scopedQuery,
  scopedCreate,
  scopedUpdate,
  isScopedDocument,
  ensureScopedDocument,
};
