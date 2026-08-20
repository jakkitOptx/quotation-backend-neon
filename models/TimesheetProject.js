const mongoose = require("mongoose");
const { normalizeScopedName } = require("../utils/timesheet");

const TimesheetProjectSchema = new mongoose.Schema(
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

TimesheetProjectSchema.pre("validate", function (next) {
  this.name = String(this.name || "").trim().replace(/\s+/g, " ");
  this.normalizedName = normalizeScopedName(this.name);
  next();
});

TimesheetProjectSchema.index(
  { userId: 1, clientId: 1, normalizedName: 1 },
  { unique: true }
);

module.exports = mongoose.model("TimesheetProject", TimesheetProjectSchema);
