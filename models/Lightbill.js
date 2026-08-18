// const mongoose = require("mongoose");

// const lightBillSchema = new mongoose.Schema({
 
//   meterNo: { type: String, required: true },
//   totalReading: { type: Number, required: true },
//   amount: { type: Number, required: true },
//   date: { type: Date, required: true },
// });

// module.exports = mongoose.model("LightBill", lightBillSchema);


const mongoose = require("mongoose");

const lightBillSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    default: null,
    index: true,
  },
  roomNo: { type: String, required: true },
  meterNo: { type: String, required: true },
  totalReading: { type: Number, required: true },
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  
});

lightBillSchema.index({ organizationId: 1, date: -1 });

module.exports = mongoose.model("LightBill", lightBillSchema);
