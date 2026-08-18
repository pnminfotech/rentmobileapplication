const express = require("express");
const mongoose = require("mongoose");

const Invite = require("../models/Invite");
const Form = require("../models/formModels");
const Room = require("../models/Room");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const {
  createInvite,
  createInviteForForm,
  validateInvite,
} = require("../controllers/invites");
const Organization = require("../models/Organization");
const { sendAdmissionSms } = require("../services/smsService");
const router = express.Router();

function propertyTypeFromTenant(tenant = {}) {
  const explicit = String(tenant.propertyType || "").toLowerCase();
  if (["room", "shop"].includes(explicit)) return explicit;

  const bedNo = String(tenant.bedNo || "").toUpperCase();
  if (bedNo === "SHOP-1") return "shop";
  if (bedNo === "ROOM-1") return "room";
  return "bed";
}

async function inferPropertyTypeFromRoom(tenant = {}, organizationId) {
  const direct = propertyTypeFromTenant(tenant);
  if (direct !== "bed") return direct;

  const roomId = String(tenant.roomId || "").trim();
  const roomNo = String(tenant.roomNo || "").trim();
  const scope = organizationId ? { organizationId } : {};
  const query = roomId && mongoose.Types.ObjectId.isValid(roomId)
    ? { _id: roomId, ...scope }
    : roomNo
    ? { roomNo, ...scope }
    : null;

  if (!query) return "bed";

  const room = await Room.findOne(query).select("propertyType").lean();
  const roomType = String(room?.propertyType || "").toLowerCase();
  return ["room", "shop"].includes(roomType) ? roomType : "bed";
}

router.post("/", attachSystemAuthIfPresent, authAdmin, createInvite);
router.post("/for-form/:id", attachSystemAuthIfPresent, authAdmin, createInviteForForm);
router.get("/:token", validateInvite);

async function submitInviteForm(req, res) {
  let claimedInvite = null;
  try {
    const token = req.params.token;
    const now = new Date();

    const inv = await Invite.findOneAndUpdate(
      {
        token,
        usedAt: null,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      },
      { $set: { usedAt: now } },
      { new: true }
    );

    if (!inv) {
      const exists = await Invite.findOne({ token }).lean();
      if (!exists) return res.status(404).json({ ok: false, message: "Invalid link" });
      if (exists.expiresAt && exists.expiresAt <= now) return res.status(410).json({ ok: false, message: "Link expired" });
      return res.status(409).json({ ok: false, message: "Link already used" });
    }

    claimedInvite = inv;

    const formId = inv.usedByFormId;
    if (!formId) {
      await Invite.updateOne({ _id: inv._id, usedAt: now }, { $set: { usedAt: null } });
      claimedInvite = null;
      return res.status(400).json({ ok: false, message: "Draft form missing" });
    }

    const allPrefillValues = Object.fromEntries(
      Object.entries(inv.prefill || {}).filter(([, value]) => value !== "" && value != null)
    );
    const lockedFieldNames = new Set([
      "category", "roomId", "floorNo", "roomNo", "bedNo",
      "propertyType", "baseRent", "rentAmount", "firstRentMonth",
      "name", "phoneNo", "joiningDate", "depositAmount", "firstRentStatus", "paymentMode",
      "hasCanteen", "canteenPlanType", "canteenStartDate", "canteenMonthlyAmount", "canteenIncludedMeals",
    ]);
    const lockedValues = Object.fromEntries(
      Object.entries(allPrefillValues).filter(([key]) => lockedFieldNames.has(key))
    );
    const lockedKeys = new Set(Object.keys(lockedValues));
    const incoming = { ...(req.body || {}) };

    for (const key of lockedKeys) {
      delete incoming[key];
    }

    const releaseInvite = () =>
      Invite.updateOne({ _id: inv._id, usedAt: now }, { $set: { usedAt: null } });
    const existingForm = await Form.findOne({
      _id: formId,
      ...(inv.organizationId ? { organizationId: inv.organizationId } : {}),
    }).lean();

    if (!existingForm) {
      await releaseInvite();
      claimedInvite = null;
      return res.status(404).json({ ok: false, message: "Tenant draft not found" });
    }

    const propertyType = await inferPropertyTypeFromRoom({ ...existingForm, ...(inv.prefill || {}) }, inv.organizationId);
    const isResidentialRoom = propertyType === "room";
    const isShop = propertyType === "shop";
    const requiredFields = [
      ["address", "Address"], ["pincode", "Pincode"], ["city", "City"],
      ["state", "State"], ["houseNo", "House number"], ["nearbyPlace", "Nearby place"],
      ...(isShop ? [] : [["dob", "Date of birth"]]),
      ...(isResidentialRoom
        ? [["familyMembers", "No. of family members"]]
        : isShop
        ? [["shopBusiness", "Shop work/business"]]
        : [
            ["relativeAddress1", "Relative address"],
            ["relative1Relation", "First contact relation"],
            ["relative1Name", "First contact name"], ["relative1Phone", "First contact phone"],
            ["relative2Relation", "Second contact relation"],
            ["relative2Name", "Second contact name"], ["relative2Phone", "Second contact phone"],
            ["companyAddress", "Company or college"],
            ["dateOfJoiningCollege", "Company or college joining date"],
          ]),
    ];

    for (const [key, label] of requiredFields) {
      if (!String(incoming[key] ?? existingForm[key] ?? "").trim()) {
        await releaseInvite();
        return res.status(400).json({ ok: false, message: `${label} is required` });
      }
    }

    if (!/^\d{6}$/.test(String(incoming.pincode ?? existingForm.pincode ?? ""))) {
      await releaseInvite();
      return res.status(400).json({ ok: false, message: "Pincode must be 6 digits" });
    }

    if (!isResidentialRoom && !isShop && [
      incoming.relative1Phone ?? existingForm.relative1Phone,
      incoming.relative2Phone ?? existingForm.relative2Phone,
    ].some((value) => !/^\d{10}$/.test(String(value)))) {
      await releaseInvite();
      return res.status(400).json({ ok: false, message: "Contact phone numbers must be 10 digits" });
    }

    const documents = Array.isArray(incoming.documents) ? incoming.documents : [];
    const existingDocuments = Array.isArray(existingForm.documents) ? existingForm.documents : [];
    const relations = new Set([...existingDocuments, ...documents].map((document) => String(document?.relation || "").toLowerCase()));
    const requiredDocumentRelations = isResidentialRoom
      ? ["self aadhaar card", "partner aadhaar card", "tenant photograph (selfie)"]
      : isShop
      ? ["self aadhaar card", "tenant photograph (selfie)"]
      : ["self aadhaar card", "parent aadhaar card", "tenant photo"];

    if (!requiredDocumentRelations.every((relation) => relations.has(relation))) {
      await releaseInvite();
      return res.status(400).json({ ok: false, message: "All required tenant documents are required" });
    }

    if (documents.length) {
      const replacedRelations = new Set(
        documents.map((document) => String(document?.relation || "").trim().toLowerCase()).filter(Boolean)
      );
      incoming.documents = [
        ...existingDocuments.filter(
          (document) => !replacedRelations.has(String(document?.relation || "").trim().toLowerCase())
        ),
        ...documents,
      ];
    } else {
      delete incoming.documents;
    }

    const updated = await Form.findOneAndUpdate(
      { _id: formId, ...(inv.organizationId ? { organizationId: inv.organizationId } : {}) },
      { $set: { ...lockedValues, ...incoming, propertyType, intakeStatus: "submitted" } },
      { new: true }
    );

    if (!updated) {
      await releaseInvite();
      claimedInvite = null;
      return res.status(404).json({ ok: false, message: "Tenant draft not found" });
    }
const organization = updated.organizationId
  ? await Organization.findById(updated.organizationId).lean()
  : null;

sendAdmissionSms(updated, organization || {}).catch((err) =>
  console.error("Admission SMS failed:", err.message)
);
    claimedInvite = null;
    return res.json({ ok: true, message: "Saved", form: updated });
  } catch (err) {
    if (claimedInvite?._id) {
      await Invite.updateOne(
        { _id: claimedInvite._id, usedAt: claimedInvite.usedAt },
        { $set: { usedAt: null } }
      ).catch(() => {});
    }
    console.error("Invite submit failed:", err);
    return res.status(500).json({ ok: false, message: err?.message || "Server error" });
  }
}

router.put("/:token/submit", submitInviteForm);

module.exports = router;
module.exports.submitInviteForm = submitInviteForm;
