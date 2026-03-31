// model Logs.js
const mongoose = require("mongoose");

const LogSchema = new mongoose.Schema({
  quotationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Quotation",
    default: null,
  },
  travelExpenseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "TravelExpense",
    default: null,
  },
  resourceType: {
    type: String,
    enum: ["quotation", "travel-expense"],
    default: "quotation",
  },
  action: { type: String, required: true },
  performedBy: { type: String, required: true },
  description: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now },
});

LogSchema.index({ quotationId: 1 });
LogSchema.index({ travelExpenseId: 1 });
LogSchema.index({ resourceType: 1, timestamp: -1 });

module.exports = mongoose.models.Log || mongoose.model("Log", LogSchema);
