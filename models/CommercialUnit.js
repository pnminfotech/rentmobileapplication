const mongoose = require("mongoose");

const CommercialUnitSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    category: { type: String, required: true, trim: true },
    buildingName: { type: String, required: true, trim: true },
    floorNo: { type: String, default: "", trim: true },
    unitNo: { type: String, required: true, trim: true },
    unitType: {
      type: String,
      enum: ["room", "shop"],
      required: true,
      default: "room",
    },
    price: { type: Number, default: null },
  },
  { timestamps: true }
);

CommercialUnitSchema.index(
  { organizationId: 1, category: 1, buildingName: 1, unitNo: 1, unitType: 1 },
  { unique: true, name: "commercial_unit_unique" }
);

module.exports =
  mongoose.models.CommercialUnit ||
  mongoose.model("CommercialUnit", CommercialUnitSchema);
