const mongoose = require("mongoose");

const TravelExpenseSchema = new mongoose.Schema(
  {
    origin: { type: String, required: true, trim: true },
    destination: { type: String, required: true, trim: true },
    departureDateTime: { type: Date, required: true },

    transportationType: {
      type: String,
      enum: ["Taxi", "BTS", "MRT", "Bus", "Grab", "Personal Car", "Other", "Car"],
      default: "Car",
    },

    distanceKm: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },

    note: { type: String, default: "", trim: true },
    requestedBy: { type: String, required: true, trim: true },

    department: { type: String, default: "" },
    team: { type: String, default: "" },
    teamGroup: { type: String, default: "" },

    receiptUrl: { type: String, default: "" },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },

    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TravelExpense ||
  mongoose.model("TravelExpense", TravelExpenseSchema);