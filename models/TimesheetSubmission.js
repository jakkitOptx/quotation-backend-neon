const mongoose = require("mongoose");

const TimesheetApprovalStepSchema = new mongoose.Schema(
  {
    level: { type: Number, required: true },
    approverUsername: { type: String, required: true, trim: true },
    approverUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["waiting", "pending", "approved", "rejected"],
      required: true,
    },
    actedAt: { type: Date, default: null },
    comment: { type: String, default: "", trim: true },
  },
  { _id: false }
);

const TimesheetSubmissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    periodType: {
      type: String,
      enum: ["week", "month"],
      required: true,
    },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "withdrawn"],
      default: "pending",
      required: true,
    },
    totalHours: { type: Number, required: true, min: 0 },
    currentApprovalLevel: { type: Number, default: null },
    approvalSteps: { type: [TimesheetApprovalStepSchema], default: [] },
    submittedAt: { type: Date, required: true, default: Date.now },
    approvedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    rejectionReason: { type: String, default: "", trim: true },
    latestComment: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

// Rejected and withdrawn submissions stay as audit history and can be resubmitted.
TimesheetSubmissionSchema.index(
  { userId: 1, periodType: 1, periodStart: 1, periodEnd: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "approved"] } },
  }
);

TimesheetSubmissionSchema.index({ userId: 1, submittedAt: -1 });
TimesheetSubmissionSchema.index({ userId: 1, periodStart: 1, periodEnd: 1, status: 1 });
TimesheetSubmissionSchema.index({
  status: 1,
  currentApprovalLevel: 1,
  "approvalSteps.approverUserId": 1,
  submittedAt: 1,
});
TimesheetSubmissionSchema.index({
  status: 1,
  currentApprovalLevel: 1,
  "approvalSteps.approverUsername": 1,
  submittedAt: 1,
});

module.exports = mongoose.model("TimesheetSubmission", TimesheetSubmissionSchema);
