const mongoose = require("mongoose");
const { normalizeScopedName } = require("../utils/timesheet");

const TimesheetDetailSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TimesheetProject",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

TimesheetDetailSchema.pre("validate", function (next) {
  this.name = String(this.name || "").trim().replace(/\s+/g, " ");
  this.normalizedName = normalizeScopedName(this.name);
  next();
});

TimesheetDetailSchema.index(
  { userId: 1, projectId: 1, normalizedName: 1 },
  { unique: true }
);

module.exports = mongoose.model("TimesheetDetail", TimesheetDetailSchema);
