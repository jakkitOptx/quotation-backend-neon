const mongoose = require("mongoose");

const TravelExpenseApprovalStepSchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },
    actedBy: { type: String, default: "" },
    actedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: "" },
  },
  { _id: false }
);

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
    tollFee: { type: Number, default: 0 },

    note: { type: String, default: "", trim: true },
    requestedBy: { type: String, required: true, trim: true },
    requestedByLevel: { type: Number, required: true, default: 1 },
    quotationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quotation",
      default: null,
    },
    quotationNumber: { type: String, default: "", trim: true },
    quotationYear: { type: Number, default: null },
    quotationType: { type: String, default: "", trim: true },
    quotationTitle: { type: String, default: "", trim: true },
    projectName: { type: String, default: "", trim: true },
    documentRunNumber: { type: String, default: "", trim: true },
    documentNo: { type: String, default: "", trim: true },

    department: { type: String, default: "" },
    team: { type: String, default: "" },
    teamGroup: { type: String, default: "" },

    receiptUrl: { type: String, default: "" },
    tollReceiptUrls: { type: [String], default: [] },

    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected"],
      default: "Pending",
    },

    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    rejectedReason: { type: String, default: "" },
    approvalSteps: { type: [TravelExpenseApprovalStepSchema], default: [] },
    currentApprovalLevel: { type: Number, default: null },
  },
  { timestamps: true }
);

TravelExpenseSchema.index({ quotationType: 1, documentRunNumber: 1 });
TravelExpenseSchema.index({ documentNo: 1 });

module.exports =
  mongoose.models.TravelExpense ||
  mongoose.model("TravelExpense", TravelExpenseSchema);
