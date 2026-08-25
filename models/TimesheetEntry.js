const mongoose = require("mongoose");

const TimesheetEntrySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimesheetProject",
      required: true,
      index: true,
    },
    detailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimesheetDetail",
      required: true,
      index: true,
    },
    workDate: {
      type: Date,
      required: true,
    },
    hours: {
      type: Number,
      required: true,
      min: 0,
      max: 24,
      validate: {
        validator(value) {
          return Number.isFinite(value) && value > 0 && value <= 24;
        },
        message: "Hours must be greater than 0 and less than or equal to 24",
      },
    },
  },
  {
    timestamps: true,
  }
);

TimesheetEntrySchema.index({ userId: 1, workDate: 1 });
TimesheetEntrySchema.index({ userId: 1, clientId: 1, workDate: 1 });
TimesheetEntrySchema.index({ userId: 1, projectId: 1, workDate: 1 });
TimesheetEntrySchema.index(
  { userId: 1, detailId: 1, workDate: 1 },
  { unique: true }
);

module.exports = mongoose.model("TimesheetEntry", TimesheetEntrySchema);
