// // routes/roomRoutes.js
// const express = require("express");
// const router = express.Router();
// const Room = require("../models/Room");

// // 🔔 Log when this router file is loaded by server.js
// console.log("✅ roomRoutes.js loaded");

// /* ------------------- GET all rooms ------------------- */
// // GET /api/rooms
// router.get("/", async (req, res) => {
//   try {
//     const rooms = await Room.find().sort({ floorNo: 1, roomNo: 1 });
//     res.json(rooms);
//   } catch (err) {
//     console.error("Error fetching rooms:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------- Create room --------------------- */
// // POST /api/rooms
// // body: { category, floorNo, roomNo }
// router.post("/", async (req, res) => {
//   try {
//     const { category, floorNo, roomNo } = req.body || {};

//     if (!category || !floorNo || !roomNo) {
//       return res
//         .status(400)
//         .json({ message: "category, floorNo and roomNo are required" });
//     }

//     // avoid duplicate roomNo
//     const existing = await Room.findOne({ roomNo });
//     if (existing) {
//       return res
//         .status(400)
//         .json({ message: "Room with this roomNo already exists" });
//     }

//     const room = new Room({
//       category: String(category).trim(),
//       floorNo: String(floorNo).trim(),
//       roomNo: String(roomNo).trim(),
//       beds: [], // first bed will be added via /:roomNo/bed
//     });

//     await room.save();
//     res.status(201).json(room);
//   } catch (err) {
//     console.error("Error adding room:", err);
//     if (err && err.code === 11000) {
//       return res
//         .status(400)
//         .json({ message: "Room with this roomNo already exists" });
//     }
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------ Add bed to room ------------------ */
// // POST /api/rooms/:roomNo/bed
// // body: { bedNo, bedCategory?, price? }
// router.post("/:roomNo/bed", async (req, res) => {
//   const { roomNo } = req.params;
//   let { bedNo, bedCategory, price } = req.body || {};

//   console.log("🔹 ADD BED request body:", req.body);

//   try {
//     if (!bedNo) {
//       return res.status(400).json({ message: "Missing bedNo" });
//     }

//     const room = await Room.findOne({ roomNo });
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     // duplicate bedNo check (case-insensitive)
//     const exists = room.beds.some(
//       (bed) =>
//         String(bed.bedNo).trim().toLowerCase() ===
//         String(bedNo).trim().toLowerCase()
//     );
//     if (exists) {
//       return res
//         .status(400)
//         .json({ message: "Bed number already exists in this room" });
//     }

//     // normalise values
//     bedNo = String(bedNo).trim();
//     bedCategory = bedCategory ? String(bedCategory).trim() : "";

//     if (price === undefined || price === "") {
//       price = null;
//     } else {
//       price = Number(price);
//       if (Number.isNaN(price)) price = null;
//     }

//     console.log("🔹 Pushing bed:", { bedNo, bedCategory, price });
//     room.beds.push({ bedNo, bedCategory, price });
//     await room.save();

//     res.json({ message: "Bed added successfully", room });
//   } catch (err) {
//     console.error("Error adding bed:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ----------------- Update bed price ------------------ */
// // PUT /api/rooms/:roomNo/bed/:bedNo
// router.put("/:roomNo/bed/:bedNo", async (req, res) => {
//   const { roomNo, bedNo } = req.params;
//   const { price } = req.body || {};

//   try {
//     const room = await Room.findOne({ roomNo });
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     const bed = room.beds.find(
//       (b) =>
//         String(b.bedNo).trim().toLowerCase() ===
//         String(bedNo).trim().toLowerCase()
//     );
//     if (!bed) return res.status(404).json({ message: "Bed not found" });

//     if (price === undefined || price === "") {
//       bed.price = null;
//     } else {
//       const num = Number(price);
//       if (Number.isNaN(num)) {
//         return res.status(400).json({ message: "Invalid price" });
//       }
//       bed.price = num;
//     }

//     await room.save();
//     res.json(bed);
//   } catch (err) {
//     console.error("Error updating bed price:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------ Delete bed from room ------------- */
// // DELETE /api/rooms/:roomNo/bed/:bedNo
// router.delete("/:roomNo/bed/:bedNo", async (req, res) => {
//   const { roomNo, bedNo } = req.params;
//   console.log("🔥 DELETE BED hit:", { roomNo, bedNo });

//   try {
//     const room = await Room.findOne({ roomNo });
//     if (!room) {
//       console.log("  ❌ Room not found");
//       return res.status(404).json({ message: "Room not found" });
//     }

//     const beforeCount = room.beds.length;

//     room.beds = room.beds.filter(
//       (b) =>
//         String(b.bedNo).trim().toLowerCase() !==
//         String(bedNo).trim().toLowerCase()
//     );

//     if (room.beds.length === beforeCount) {
//       console.log("  ❌ Bed not found");
//       return res.status(404).json({ message: "Bed not found" });
//     }

//     await room.save();
//     console.log("  ✅ Bed deleted successfully");
//     return res.json({ message: "Bed deleted successfully", room });
//   } catch (err) {
//     console.error("Error deleting bed:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// module.exports = router;







const express = require("express");
const router = express.Router();
const Room = require("../models/Room");
const Form = require("../models/Form");
const authAdmin = require("../middleware/adminAuth");
const { attachSystemAuthIfPresent } = require("../middleware/saasAuth");
const { assertUnitCapacity, getUnitQuota } = require("../services/unitQuota");
const {
  scopedQuery,
  scopedCreate,
  scopedUpdate,
  ensureScopedDocument,
} = require("../utils/organizationScope");

router.use(attachSystemAuthIfPresent);
router.use(authAdmin);

function normalizePropertyType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "room" || raw === "shop") return raw;
  return "bed";
}

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeIdentifier(value) {
  return normalizeText(value).toUpperCase();
}

function todayKey() {
  const date = new Date();
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function placeholderCapacity(unit) {
  const type = normalizePropertyType(unit?.propertyType);
  if (type === "bed") return Array.isArray(unit?.beds) ? Math.max(unit.beds.length, 1) : 1;
  return 1;
}

function activeTenantQueryForUnit(room) {
  const propertyType = normalizePropertyType(room.propertyType);
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  return {
    propertyType,
    category: String(room.category || "").trim(),
    floorNo: String(room.floorNo || "").trim(),
    roomNo: String(room.roomNo || "").trim(),
    intakeStatus: { $ne: "pending_tenant" },
    $or: [
      { leaveDate: { $exists: false } },
      { leaveDate: null },
      { leaveDate: "" },
      { leaveDate: { $type: "string", $gt: todayKey() } },
      { leaveDate: { $type: "date", $gt: endOfToday } },
    ],
  };
}

router.get("/", async (req, res) => {
  try {
    if (req.organizationId) {
      await getUnitQuota(req.organizationId);
    }
    const rooms = await Room.find(scopedQuery(req)).sort({ floorNo: 1, roomNo: 1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/usage", async (req, res) => {
  try {
    const quota = await getUnitQuota(req.organizationId);
    res.json(quota);
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Unable to load unit usage",
      code: err.code,
    });
  }
});
// ======================================================
// RENAME PROPERTY / BUILDING
// PUT /api/rooms/properties/rename
// body: { propertyType, oldName, newName }
// ======================================================

router.put("/properties/rename", async (req, res) => {
  try {
    const propertyType = normalizePropertyType(req.body?.propertyType);
    const oldName = normalizeText(req.body?.oldName);
    const newName = normalizeText(req.body?.newName);

    if (!oldName || !newName) {
      return res.status(400).json({
        message: "Old property name and new property name are required",
      });
    }

    // Find all units belonging to this property
    const sourceUnits = await Room.find(
      scopedQuery(req, {
        propertyType,
        category: oldName,
      })
    ).lean();

    if (!sourceUnits.length) {
      return res.status(404).json({
        message: "Property not found",
      });
    }

    // Check whether new property name already exists
    // and would create duplicate units
    if (oldName.toLowerCase() !== newName.toLowerCase()) {
      const targetUnits = await Room.find(
        scopedQuery(req, {
          propertyType,
          category: newName,
        })
      )
        .collation({ locale: "en", strength: 2 })
        .lean();

      if (targetUnits.length) {
        const targetLocations = new Set(
          targetUnits.map((unit) =>
            [
              normalizeText(unit.floorNo).toLowerCase(),
              normalizeIdentifier(unit.roomNo).toLowerCase(),
              normalizeText(unit.wingName).toLowerCase(),
            ].join("::")
          )
        );

        const collision = sourceUnits.find((unit) =>
          targetLocations.has(
            [
              normalizeText(unit.floorNo).toLowerCase(),
              normalizeIdentifier(unit.roomNo).toLowerCase(),
              normalizeText(unit.wingName).toLowerCase(),
            ].join("::")
          )
        );

        if (collision) {
          return res.status(400).json({
            message:
              "Cannot use this property name because matching units already exist there",
          });
        }
      }
    }

    // Update property name in ALL rooms/units
    const roomResult = await Room.updateMany(
      scopedQuery(req, {
        propertyType,
        category: oldName,
      }),
      {
        $set: scopedUpdate(req, {
          category: newName,
        }),
      }
    );

    // Update property name in ALL tenant records also
    const tenantResult = await Form.updateMany(
      scopedQuery(req, {
        propertyType,
        category: oldName,
      }),
      {
        $set: scopedUpdate(req, {
          category: newName,
        }),
      }
    );

    return res.json({
      message: "Property name updated successfully",
      oldName,
      newName,
      updatedUnits:
        roomResult.modifiedCount ?? roomResult.nModified ?? 0,
      updatedTenants:
        tenantResult.modifiedCount ?? tenantResult.nModified ?? 0,
    });
  } catch (err) {
    console.error("Rename property error:", err);

    return res.status(500).json({
      message: "Unable to rename property",
      error: err.message,
    });
  }
});
router.get("/:roomId", async (req, res) => {
  try {
    const unit = await Room.findOne(scopedQuery(req, { _id: req.params.roomId })).lean();
    if (!unit) return res.status(404).json({ message: "Unit not found" });

    const quota = await getUnitQuota(req.organizationId);
    res.json({ unit, quota });
  } catch (err) {
    if (err?.name === "CastError") {
      return res.status(404).json({ message: "Unit not found" });
    }
    res.status(err.status || 500).json({
      message: err.message || "Unable to load unit",
      code: err.code,
    });
  }
});

// ✅ Create room: check duplicate only inside same category
router.post("/", async (req, res) => {
  try {
    const {
      category,
      floorNo,
      roomNo,
      propertyType,
      hasWing,
      wingName,
      flatType,
      meterNo,
      lastMeterReading,
      bedCount,
      bedCategory,
      price,
    } = req.body || {};
    if (!category || !floorNo || !roomNo) {
      return res.status(400).json({ message: "category, floorNo and roomNo are required" });
    }

    const cat = normalizeText(category);
    const flr = normalizeText(floorNo);
    const rno = normalizeIdentifier(roomNo);
    const normalizedPropertyType = normalizePropertyType(propertyType);
    const normalizedHasWing = Boolean(hasWing);
    const normalizedWingName = normalizedHasWing ? normalizeText(wingName) : "";
    const normalizedFlatType =
      normalizedPropertyType === "room" ? normalizeText(flatType) : "";
    const normalizedMeterNo = normalizeIdentifier(meterNo);
    const normalizedPrice =
      price === undefined || price === "" ? null : Number(price);
    const normalizedLastMeterReading =
      lastMeterReading === undefined || lastMeterReading === "" || lastMeterReading === null
        ? null
        : Number(lastMeterReading);

    if (normalizedPrice !== null && (!Number.isFinite(normalizedPrice) || normalizedPrice < 0)) {
      return res.status(400).json({ message: "Invalid monthly price" });
    }
    if (normalizedLastMeterReading !== null && (!Number.isFinite(normalizedLastMeterReading) || normalizedLastMeterReading < 0)) {
      return res.status(400).json({ message: "Invalid meter reading" });
    }

    const normalizedBedCount =
      normalizedPropertyType === "bed" && bedCount !== undefined
        ? Number(bedCount)
        : 0;
    if (
      normalizedPropertyType === "bed" &&
      bedCount !== undefined &&
      (!Number.isInteger(normalizedBedCount) || normalizedBedCount < 1)
    ) {
      return res.status(400).json({ message: "bedCount must be a positive integer" });
    }

    if (normalizedHasWing && !normalizedWingName) {
      return res.status(400).json({ message: "wingName is required when hasWing is enabled" });
    }

    if (normalizedPropertyType === "room" && !normalizedFlatType) {
      return res.status(400).json({ message: "flatType is required for residential rooms" });
    }

    const existing = await Room.findOne(scopedQuery(req, {
      propertyType: normalizedPropertyType,
      category: cat,
      floorNo: flr,
      roomNo: rno,
      wingName: normalizedWingName,
      isPlaceholder: { $ne: true },
    })).collation({ locale: "en", strength: 2 });

    if (existing) {
      return res.status(400).json({ message: "Unit already exists in this location" });
    }

    if (normalizedMeterNo) {
      const existingMeter = await Room.findOne(scopedQuery(req, {
        meterNo: normalizedMeterNo,
      })).collation({ locale: "en", strength: 2 });
      if (existingMeter) {
        return res.status(400).json({ message: "Meter number already exists for another unit" });
      }
    }

    const requestedUnits =
      normalizedPropertyType === "bed"
        ? { beds: normalizedBedCount }
        : normalizedPropertyType === "room"
          ? { rooms: 1 }
          : { shops: 1 };

    const beds =
      normalizedPropertyType === "bed"
        ? Array.from({ length: normalizedBedCount }, (_, index) => ({
            bedNo: `B${index + 1}`,
            bedCategory: normalizeText(bedCategory || "Standard") || "Standard",
            price: normalizedPrice,
          }))
        : [
            {
              bedNo: normalizedPropertyType === "shop" ? "SHOP-1" : "ROOM-1",
              bedCategory: "Primary",
              price: normalizedPrice,
          },
        ];

    const neededCapacity =
      normalizedPropertyType === "bed" ? normalizedBedCount : 1;
    const placeholders = await Room.find(scopedQuery(req, {
      propertyType: normalizedPropertyType,
      isPlaceholder: true,
    })).sort({ createdAt: 1 });
    const availablePlaceholderCapacity = placeholders.reduce((sum, unit) => sum + placeholderCapacity(unit), 0);

    if (availablePlaceholderCapacity < neededCapacity) {
      await assertUnitCapacity(req.organizationId, requestedUnits);
    }

    if (placeholders.length && availablePlaceholderCapacity >= neededCapacity) {
      const [primaryPlaceholder, ...extraPlaceholders] = placeholders;
      const primaryPlaceholderCapacity = placeholderCapacity(primaryPlaceholder);
      primaryPlaceholder.category = cat;
      primaryPlaceholder.hasWing = normalizedHasWing;
      primaryPlaceholder.wingName = normalizedWingName;
      primaryPlaceholder.floorNo = flr;
      primaryPlaceholder.flatType = normalizedFlatType;
      primaryPlaceholder.roomNo = rno;
      primaryPlaceholder.meterNo = normalizedMeterNo;
      primaryPlaceholder.lastMeterReading = normalizedLastMeterReading;
      primaryPlaceholder.beds = beds;
      primaryPlaceholder.isPlaceholder = false;
      await primaryPlaceholder.save();

      if (normalizedPropertyType === "bed" && neededCapacity > 1) {
        let remainingToConsume = neededCapacity - primaryPlaceholderCapacity;
        const deleteIds = [];
        for (const placeholder of extraPlaceholders) {
          if (remainingToConsume <= 0) break;
          remainingToConsume -= placeholderCapacity(placeholder);
          deleteIds.push(placeholder._id);
        }
        if (deleteIds.length) {
          await Room.deleteMany(scopedQuery(req, { _id: { $in: deleteIds }, isPlaceholder: true }));
        }
      }

      return res.status(201).json(primaryPlaceholder);
    }

    const room = await Room.create(scopedCreate(req, {
      propertyType: normalizedPropertyType,
      category: cat,
      hasWing: normalizedHasWing,
      wingName: normalizedWingName,
      floorNo: flr,
      flatType: normalizedFlatType,
      roomNo: rno,
      meterNo: normalizedMeterNo,
      lastMeterReading: normalizedLastMeterReading,
      beds,
      isPlaceholder: false,
    }));
    return res.status(201).json(room);
  } catch (err) {
    if (err?.code === "UNIT_LIMIT_EXCEEDED") {
      return res.status(err.status || 403).json({
        message: err.message,
        code: err.code,
        details: err.details,
      });
    }
    // duplicate key error for compound index
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Unit already exists in this location" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ✅ Add bed by roomId
router.post("/:roomId/beds", async (req, res) => {
  try {
    const count = Number(req.body?.count);
    const bedCategory = normalizeText(req.body?.bedCategory || "Standard") || "Standard";
    const price = Number(req.body?.price);

    if (!Number.isInteger(count) || count < 1) {
      return res.status(400).json({ message: "count must be a positive integer" });
    }
    if (!Number.isFinite(price) || price < 0) {
      return res.status(400).json({ message: "Invalid monthly price" });
    }

    const room = await Room.findOne(scopedQuery(req, { _id: req.params.roomId }));
    if (!room) return res.status(404).json({ message: "Room not found" });
    if (normalizePropertyType(room.propertyType) !== "bed") {
      return res.status(400).json({ message: "Beds can be added only to bed-wise rooms" });
    }

    await assertUnitCapacity(req.organizationId, { beds: count });

    const usedNumbers = new Set(
      (room.beds || [])
        .map((bed) => /^B(\d+)$/i.exec(String(bed.bedNo || "")))
        .filter(Boolean)
        .map((match) => Number(match[1]))
    );
    const added = [];
    let candidate = 1;
    while (added.length < count) {
      if (!usedNumbers.has(candidate)) {
        const bed = { bedNo: `B${candidate}`, bedCategory, price };
        room.beds.push(bed);
        added.push(bed);
        usedNumbers.add(candidate);
      }
      candidate += 1;
    }

    await room.save();
    const quota = await getUnitQuota(req.organizationId);
    res.status(201).json({
      message: `${added.length} beds added successfully`,
      room,
      added,
      quota,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Internal server error",
      code: err.code,
      details: err.details,
    });
  }
});

router.post("/:roomId/bed", async (req, res) => {
  const { roomId } = req.params;
  let { bedNo, bedCategory, price, usePlaceholder, placeholderRoomId } = req.body || {};

  try {
    if (!bedNo) return res.status(400).json({ message: "Missing bedNo" });

    const room = await Room.findById(roomId);
    if (!ensureScopedDocument(req, room, res, "Room not found")) return;
    if (normalizePropertyType(room.propertyType) !== "bed") {
      return res.status(400).json({ message: "Additional beds are allowed only for bed-wise properties" });
    }

    const exists = room.beds.some(
      (b) => String(b.bedNo).trim().toLowerCase() === String(bedNo).trim().toLowerCase()
    );
    if (exists) return res.status(400).json({ message: "Bed already exists in this room" });

    let usedPlaceholder = null;
    try {
      await assertUnitCapacity(req.organizationId, { beds: 1 });
    } catch (quotaErr) {
      if (!usePlaceholder || quotaErr?.code !== "UNIT_LIMIT_EXCEEDED") {
        throw quotaErr;
      }

      const placeholderQuery = {
        propertyType: "bed",
        isPlaceholder: true,
        ...(placeholderRoomId ? { _id: placeholderRoomId } : {}),
      };
      usedPlaceholder = await Room.findOne(scopedQuery(req, placeholderQuery)).sort({ roomNo: 1 });
      if (!usedPlaceholder) {
        return res.status(400).json({ message: "No pending bed unit is available to use" });
      }

      const activeTenant = await Form.findOne(scopedQuery(req, activeTenantQueryForUnit(usedPlaceholder))).lean();
      if (activeTenant) {
        return res.status(400).json({
          message: "Selected pending unit cannot be used because a tenant is assigned to it",
        });
      }
    }

    bedNo = normalizeIdentifier(bedNo);
    bedCategory = bedCategory ? normalizeText(bedCategory) : "";

    if (price === undefined || price === "") price = null;
    else {
      price = Number(price);
      if (Number.isNaN(price)) price = null;
    }

    room.beds.push({ bedNo, bedCategory, price });
    await room.save();
    if (usedPlaceholder?._id) {
      await Room.deleteOne(scopedQuery(req, { _id: usedPlaceholder._id, isPlaceholder: true }));
    }

    res.json({
      message: usedPlaceholder ? "Pending unit used and bed added successfully" : "Bed added successfully",
      room,
      usedPlaceholderId: usedPlaceholder?._id,
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Internal server error",
      code: err.code,
      details: err.details,
    });
  }
});

// ✅ Update bed price by roomId
// router.put("/:roomId/bed/:bedNo", async (req, res) => {
//   const { roomId, bedNo } = req.params;
//   const { price } = req.body || {};

//   try {
//     const room = await Room.findById(roomId);
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     const bed = room.beds.find(
//       (b) => String(b.bedNo).trim().toLowerCase() === String(bedNo).trim().toLowerCase()
//     );
//     if (!bed) return res.status(404).json({ message: "Bed not found" });

//     if (price === undefined || price === "") bed.price = null;
//     else {
//       const num = Number(price);
//       if (Number.isNaN(num)) return res.status(400).json({ message: "Invalid price" });
//       bed.price = num;
//     }

//     await room.save();
//     res.json(bed);
//   } catch (err) {
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

router.post("/:roomId/bed/from-placeholder", async (req, res) => {
  const { roomId } = req.params;
  let { bedNo, bedCategory, price, placeholderRoomId } = req.body || {};

  try {
    if (!bedNo) return res.status(400).json({ message: "Missing bedNo" });

    const room = await Room.findOne(scopedQuery(req, { _id: roomId }));
    if (!ensureScopedDocument(req, room, res, "Room not found")) return;
    if (normalizePropertyType(room.propertyType) !== "bed") {
      return res.status(400).json({ message: "Additional beds are allowed only for bed-wise properties" });
    }

    bedNo = normalizeIdentifier(bedNo);
    const exists = (room.beds || []).some(
      (b) => String(b.bedNo).trim().toLowerCase() === String(bedNo).trim().toLowerCase()
    );
    if (exists) return res.status(400).json({ message: "Bed already exists in this room" });

    const placeholderQuery = {
      propertyType: "bed",
      isPlaceholder: true,
      ...(placeholderRoomId ? { _id: placeholderRoomId } : {}),
    };
    const placeholder = await Room.findOne(scopedQuery(req, placeholderQuery)).sort({ roomNo: 1 });
    if (!placeholder) {
      return res.status(400).json({ message: "No pending bed unit is available to use" });
    }

    const activeTenant = await Form.findOne(scopedQuery(req, activeTenantQueryForUnit(placeholder))).lean();
    if (activeTenant) {
      return res.status(400).json({ message: "Selected pending unit cannot be used because a tenant is assigned to it" });
    }

    bedCategory = bedCategory ? normalizeText(bedCategory) : "";
    if (price === undefined || price === "") price = null;
    else {
      price = Number(price);
      if (Number.isNaN(price)) price = null;
    }

    room.beds.push({ bedNo, bedCategory, price });
    await room.save();
    await Room.deleteOne(scopedQuery(req, { _id: placeholder._id, isPlaceholder: true }));

    const updatedRoom = await Room.findOne(scopedQuery(req, { _id: room._id })).lean();
    res.status(201).json({
      message: "Pending unit used and bed added successfully",
      room: updatedRoom,
      usedPlaceholderId: placeholder._id,
      quota: await getUnitQuota(req.organizationId),
    });
  } catch (err) {
    res.status(err.status || 500).json({
      message: err.message || "Internal server error",
      code: err.code,
      details: err.details,
    });
  }
});

router.put("/:roomId/bed/:bedNo", async (req, res) => {
  const { roomId, bedNo } = req.params;
  const { price, bedCategory } = req.body || {};

  try {
    const room = await Room.findById(roomId);
    if (!ensureScopedDocument(req, room, res, "Room not found")) return;

    const bed = room.beds.find(
      (b) =>
        String(b.bedNo).trim().toLowerCase() ===
        String(bedNo).trim().toLowerCase()
    );
    if (!bed) return res.status(404).json({ message: "Bed not found" });

    // ✅ Update price (allow clearing)
    if (price !== undefined) {
      if (price === "") bed.price = null;
      else {
        const num = Number(price);
        if (Number.isNaN(num))
          return res.status(400).json({ message: "Invalid price" });
        bed.price = num;
      }
    }

    // ✅ Update bedCategory (allow clearing)
    if (bedCategory !== undefined) {
      bed.bedCategory = String(bedCategory).trim(); // "" allowed to clear
    }

    await room.save();
    res.json(bed);
  } catch (err) {
    console.error("Update bed error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// ✅ Delete bed by roomId
router.delete("/:roomId/bed/:bedNo", async (req, res) => {
  const { roomId, bedNo } = req.params;

  try {
    const room = await Room.findOne(scopedQuery(req, { _id: roomId }));
    if (!ensureScopedDocument(req, room, res, "Room not found")) return;

    if (normalizePropertyType(room.propertyType) !== "bed") {
      return res.status(400).json({ message: "Beds can be deleted only from hostel rooms" });
    }

    const existingBed = (room.beds || []).find(
      (bed) => String(bed.bedNo || "").trim().toLowerCase() === String(bedNo || "").trim().toLowerCase()
    );

    if (!existingBed) {
      return res.status(404).json({ message: "Bed not found" });
    }

    const activeTenant = await Form.findOne(scopedQuery(req, {
      propertyType: "bed",
      bedNo: String(existingBed.bedNo),
      leaveDate: { $in: [null, ""] },
      $or: [
        { roomId: String(room._id) },
        { roomNo: String(room.roomNo || "").trim() },
      ],
    })).lean();

    if (activeTenant) {
      return res.status(400).json({
        message: "Cannot delete this bed because a tenant is assigned to it",
      });
    }

    room.beds = (room.beds || []).filter(
      (bed) =>
        String(bed.bedNo || "").trim().toLowerCase() !==
        String(existingBed.bedNo || "").trim().toLowerCase()
    );

    await room.save();

    const updatedRoom = await Room.findOne(scopedQuery(req, { _id: roomId })).lean();
    return res.json({
      message: "Bed deleted successfully",
      room: updatedRoom,
      quota: await getUnitQuota(req.organizationId),
    });
  } catch (err) {
    if (err?.name === "CastError") {
      return res.status(404).json({ message: "Room not found" });
    }
    return res.status(err.status || 500).json({
      message: err.message || "Internal server error",
      code: err.code,
    });
  }
});

router.delete("/:roomId", async (req, res) => {
  const { roomId } = req.params;

  try {
    const room = await Room.findById(roomId);
    if (!ensureScopedDocument(req, room, res, "Room not found")) return;

    const activeTenant = await Form.findOne(scopedQuery(req, activeTenantQueryForUnit(room))).lean();

    if (activeTenant) {
      return res.status(400).json({
        message: "Cannot delete this room/shop because a tenant is assigned to it",
      });
    }

    await Room.findByIdAndDelete(roomId);
    return res.json({ message: "Room deleted successfully" });
  } catch (err) {
    console.error("Delete room error:", err);
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
});


// ✅ PUT /api/rooms/:roomId  -> update room category (and optionally floorNo/roomNo later)
router.put("/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { category, propertyType, floorNo, roomNo, hasWing, wingName, flatType, meterNo, lastMeterReading } = req.body || {};

  try {
    if (
      !category &&
      propertyType === undefined &&
      floorNo === undefined &&
      roomNo === undefined &&
      hasWing === undefined &&
      wingName === undefined &&
      flatType === undefined &&
      meterNo === undefined &&
      lastMeterReading === undefined
    ) {
      return res.status(400).json({ message: "At least one room field is required" });
    }

    const currentRoom = await Room.findOne(scopedQuery(req, { _id: roomId }));
    if (!currentRoom) return res.status(404).json({ message: "Room not found" });
    if (
      propertyType !== undefined &&
      normalizePropertyType(propertyType) !== normalizePropertyType(currentRoom.propertyType)
    ) {
      return res.status(400).json({
        message: "Unit type cannot be changed after creation",
      });
    }

    const update = {};
    if (category && normalizeText(category)) {
      update.category = normalizeText(category);
    }
    if (floorNo !== undefined && normalizeText(floorNo)) {
      update.floorNo = normalizeText(floorNo);
    }
    if (roomNo !== undefined && normalizeIdentifier(roomNo)) {
      update.roomNo = normalizeIdentifier(roomNo);
    }
    if (hasWing !== undefined) {
      update.hasWing = Boolean(hasWing);
      if (!update.hasWing && wingName === undefined) {
        update.wingName = "";
      }
    }
    if (wingName !== undefined) {
      update.wingName = normalizeText(wingName);
    }
    if (flatType !== undefined) {
      update.flatType = normalizeText(flatType);
    }
    if (meterNo !== undefined) {
      update.meterNo = normalizeIdentifier(meterNo);
    }
    if (lastMeterReading !== undefined) {
      if (lastMeterReading === "" || lastMeterReading === null) {
        update.lastMeterReading = null;
      } else {
        const reading = Number(lastMeterReading);
        if (!Number.isFinite(reading) || reading < 0) {
          return res.status(400).json({ message: "Invalid meter reading" });
        }
        update.lastMeterReading = reading;
      }
    }

    const nextLocation = {
      propertyType: normalizePropertyType(currentRoom.propertyType),
      category: update.category ?? currentRoom.category,
      floorNo: update.floorNo ?? currentRoom.floorNo,
      roomNo: update.roomNo ?? currentRoom.roomNo,
      wingName: update.hasWing === false ? "" : update.wingName ?? currentRoom.wingName ?? "",
    };
    const completesPlaceholder =
      currentRoom.isPlaceholder &&
      normalizeText(nextLocation.category).toLowerCase() !== "unassigned" &&
      normalizeText(nextLocation.floorNo).toLowerCase() !== "unassigned" &&
      normalizeIdentifier(nextLocation.roomNo) &&
      !normalizeIdentifier(nextLocation.roomNo).startsWith("UNASSIGNED-");
    if (completesPlaceholder) {
      update.isPlaceholder = false;
    }

    const duplicateUnit = await Room.findOne(scopedQuery(req, {
      ...nextLocation,
      _id: { $ne: roomId },
      isPlaceholder: { $ne: true },
    })).collation({ locale: "en", strength: 2 });
    if (duplicateUnit) {
      return res.status(400).json({ message: "Unit already exists in this location" });
    }

    if (update.meterNo) {
      const duplicateMeter = await Room.findOne(scopedQuery(req, {
        meterNo: update.meterNo,
        _id: { $ne: roomId },
      })).collation({ locale: "en", strength: 2 });
      if (duplicateMeter) {
        return res.status(400).json({ message: "Meter number already exists for another unit" });
      }
    }

    const updated = await Room.findOneAndUpdate(
      scopedQuery(req, { _id: roomId }),
      { $set: scopedUpdate(req, update) },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Room not found" });

    res.json(updated);
  } catch (err) {
    console.error("Update room category error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});
// PATCH /api/rooms/:roomId/bed/:bedNo  -> update bed price (and/or bedCategory)
router.patch("/:roomId/bed/:bedNo", async (req, res) => {
  try {
    const { roomId, bedNo } = req.params;
    const { price, bedCategory } = req.body;

    if (price !== undefined && (Number(price) < 0 || Number.isNaN(Number(price)))) {
      return res.status(400).json({ message: "Invalid price" });
    }

    const update = {};
    if (price !== undefined) update["beds.$.price"] = Number(price);
    if (bedCategory !== undefined) update["beds.$.bedCategory"] = String(bedCategory);

    if (!Object.keys(update).length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const room = await Room.findOneAndUpdate(
      scopedQuery(req, { _id: roomId, "beds.bedNo": String(bedNo) }),
      { $set: update },
      { new: true }
    );

    if (!room) {
      return res.status(404).json({ message: "Room/Bed not found" });
    }

    res.json({ message: "Bed updated", room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
