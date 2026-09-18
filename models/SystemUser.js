const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const systemUserSchema = new mongoose.Schema(
  {
    organizationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      default: null,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    loginId: { type: String, trim: true, lowercase: true, unique: true, sparse: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    phone: { type: String, trim: true, default: "" },
    password: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["superadmin", "system_admin"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending_payment", "active", "suspended"],
      default: "pending_payment",
      index: true,
    },
    lastLoginAt: { type: Date },
  },
  { timestamps: true }
);

systemUserSchema.pre("save", async function hashPassword(next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

systemUserSchema.methods.comparePassword = function comparePassword(candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports =
  mongoose.models.SystemUser ||
  mongoose.model("SystemUser", systemUserSchema);
