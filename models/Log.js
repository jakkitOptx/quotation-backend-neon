const mongoose = require("mongoose");

const LogSchema = new mongoose.Schema({
  quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation" },
  action: { type: String, required: true },   // approve, reject, edit, unlock
  performedBy: { type: String, required: true }, // email
  description: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now }
});

// เพิ่ม index
LogSchema.index({ quotationId: 1 });

module.exports = mongoose.model("Log", LogSchema);
