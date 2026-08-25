const mongoose = require("mongoose");

const TimesheetPeriodOverrideSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    periodType: {
      type: String,
      enum: ["week"],
      default: "week",
      required: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    reopenedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reopenedAt: { type: Date, required: true, default: Date.now },
    reopenUntil: { type: Date, required: true },
    reason: { type: String, required: true, trim: true },
    isActive: { type: Boolean, default: true },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

TimesheetPeriodOverrideSchema.index({ userId: 1, periodStart: 1, periodEnd: 1 });
TimesheetPeriodOverrideSchema.index(
  { userId: 1, periodType: 1, periodStart: 1, periodEnd: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
  }
);

module.exports = mongoose.model(
  "TimesheetPeriodOverride",
  TimesheetPeriodOverrideSchema
);
