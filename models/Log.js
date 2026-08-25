// model Logs.js
const mongoose = require("mongoose");

const MODULE_BY_RESOURCE_TYPE = {
  quotation: "quotation",
  "travel-expense": "travel_expense",
  timesheet: "timesheet",
};

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
  timesheetEntityId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },
  resourceType: {
    type: String,
    enum: ["quotation", "travel-expense", "timesheet"],
    default: "quotation",
  },
  module: {
    type: String,
    enum: ["quotation", "travel_expense", "timesheet"],
    default: null,
  },
  action: { type: String, required: true },
  performedBy: { type: String, required: true },
  description: { type: String, default: "" },
  metadata: { type: mongoose.Schema.Types.Mixed, default: null },
  timestamp: { type: Date, default: Date.now },
});

// Existing writers use resourceType; derive module for new logs without touching history.
LogSchema.pre("validate", function setModuleFromResourceType(next) {
  if (!this.module) {
    this.module = MODULE_BY_RESOURCE_TYPE[this.resourceType] || null;
  }
  next();
});

LogSchema.index({ quotationId: 1 });
LogSchema.index({ travelExpenseId: 1 });
LogSchema.index({ timesheetEntityId: 1 });
LogSchema.index({ resourceType: 1, timestamp: -1 });
LogSchema.index({ module: 1, timestamp: -1 });

module.exports = mongoose.models.Log || mongoose.model("Log", LogSchema);
