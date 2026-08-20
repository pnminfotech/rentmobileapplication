// payment-Backend/routes/uploadRoutes.js
const express = require("express");
const multer = require("multer");
const sharp = require("sharp");
const ImageKit = require("imagekit");
const path = require("path");
const authAdmin = require("../middleware/adminAuth");
const Invite = require("../models/Invite");

const router = express.Router();

// ✅ Multer memory (not disk)
const MAX_IMAGE_UPLOAD_SIZE = 2 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_UPLOAD_SIZE, files: 10 },
});

function uploadDocuments(req, res, next) {
  upload.array("documents", 10)(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Each document image must be 2 MB or smaller."
          : err.code === "LIMIT_FILE_COUNT"
          ? "You can upload up to 10 documents at a time."
          : err.message || "Document upload failed.";

      return res.status(400).json({ ok: false, message });
    }

    return res.status(400).json({ ok: false, message: err.message || "Document upload failed." });
  });
}

function hasImageKitConfig() {
  return (
    !!process.env.IMAGEKIT_PUBLIC_KEY &&
    !!process.env.IMAGEKIT_PRIVATE_KEY &&
    !!process.env.IMAGEKIT_URL_ENDPOINT
  );
}

function getImageKit() {
  if (!hasImageKitConfig()) return null;

  return new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT,
  });
}

// compress images under 10KB (same idea as your other route)
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png"]);
const ALLOWED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

function isAllowedImageFile(file) {
  if (!file) return false;

  const mime = String(file.mimetype || "").toLowerCase();
  const ext = path.extname(String(file.originalname || "")).toLowerCase();

  return ALLOWED_IMAGE_MIME_TYPES.has(mime) && ALLOWED_IMAGE_EXTENSIONS.has(ext);
}

async function compressUnder10KB(buf) {
  return sharp(buf)
    .resize({ width: 1600, withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
}

// POST /api/uploads/docs  ✅ ImageKit-only
function tokenFromUrl(value) {
  try {
    if (!value) return "";
    const parsed = new URL(String(value));
    const direct =
      parsed.searchParams.get("inviteToken") ||
      parsed.searchParams.get("inv") ||
      parsed.searchParams.get("token") ||
      parsed.searchParams.get("invite");
    if (direct) return direct;

    const hashQuery = String(parsed.hash || "").split("?")[1] || "";
    const hashParams = new URLSearchParams(hashQuery);
    return (
      hashParams.get("inviteToken") ||
      hashParams.get("inv") ||
      hashParams.get("token") ||
      hashParams.get("invite") ||
      ""
    );
  } catch {
    return "";
  }
}

function getInviteTokenFromRequest(req) {
  return String(
    req.body?.inviteToken ||
    req.body?.inv ||
    req.query?.inviteToken ||
    req.query?.inv ||
    req.query?.token ||
    req.query?.invite ||
    req.get("X-Invite-Token") ||
    tokenFromUrl(req.get("Referer")) ||
    tokenFromUrl(req.get("Referrer")) ||
    ""
  ).trim();
}

async function requireValidTenantInvite(req, res, next) {
  try {
    const token = getInviteTokenFromRequest(req);

    if (!token) {
      return res.status(401).json({
        ok: false,
        message: "Invite token is required for tenant document upload",
      });
    }

    const invite = await Invite.findOne({
      token,
      usedAt: null,
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    }).select("_id").lean();

    if (!invite) {
      return res.status(401).json({ ok: false, message: "Invalid or expired invite link" });
    }

    return next();
  } catch (e) {
    console.error("tenant upload invite auth error:", e);
    return res.status(500).json({ ok: false, message: "Unable to verify invite link" });
  }
}

function docsUploadAuth(req, res, next) {
  const referer = String(req.get("Referer") || req.get("Referrer") || "");
  const isTenantIntake =
    String(req.body?.source || "") === "tenant-intake" ||
    referer.includes("tenant-intake");

  if (getInviteTokenFromRequest(req) || isTenantIntake) {
    return requireValidTenantInvite(req, res, next);
  }

  return authAdmin(req, res, next);
}

router.post("/docs", uploadDocuments, docsUploadAuth, async (req, res) => {
  try {
    const canUseImagekit = hasImageKitConfig();

    if (!canUseImagekit) {
      return res.status(500).json({
        ok: false,
        message: "ImageKit not configured. Cannot upload documents.",
      });
    }

    const imagekit = getImageKit();

    const files = req.files || [];
    const invalidFiles = files.filter((file) => !isAllowedImageFile(file));
    if (invalidFiles.length) {
      return res.status(400).json({
        ok: false,
        message: "Only JPG, JPEG, and PNG files are allowed.",
        invalidFiles: invalidFiles.map((file) => file.originalname || "unknown"),
      });
    }

    const out = await Promise.all(files.map(async (f) => {
      const safeBaseName = (f.originalname || "doc").replace(/[^\w.\-]/g, "_");

      let uploadBuffer = f.buffer;
      let contentType = f.mimetype;
      let uploadName = `${Date.now()}_${safeBaseName}`;

      // ✅ images -> compress + convert to webp
      if (/^image\//i.test(f.mimetype)) {
        uploadBuffer = await compressUnder10KB(f.buffer);
        contentType = "image/webp";
        uploadName = `${Date.now()}_${safeBaseName}.webp`;
      }

      const ik = await imagekit.upload({
        file: uploadBuffer,
        fileName: uploadName,
        folder: "/rent-management-mobile-app/docs",
        useUniqueFileName: true,
      });

      return {
        // ✅ ImageKit CDN URL (works on localhost + live)
        url: ik.url,
        fileId: ik.fileId,
        filePath: ik.filePath,

        // meta
        filename: f.originalname,
        storedName: ik.name, // ImageKit stored name
        mimetype: contentType,
        size: uploadBuffer.length,
      };
    }));

    return res.json({ ok: true, files: out });
  } catch (e) {
    console.error("upload docs error:", e);
    return res.status(400).json({ ok: false, message: e.message || "Upload failed" });
  }
});

module.exports = router;
