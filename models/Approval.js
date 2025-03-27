// Approval.js
const mongoose = require("mongoose");

const ApprovalSchema = new mongoose.Schema({
  quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true },
  approvalHierarchy: [
    {
      level: { type: Number, required: true },
      approver: { type: String, required: true },
      status: { type: String, enum: ["Pending", "Approved", "Rejected", "Canceled"] }, // ✅ เพิ่ม "Canceled"
      approvedAt: { type: Date, default: null }, // Timestamp ที่เพิ่มเข้ามา
    },
  ],
});

module.exports = mongoose.model("Approval", ApprovalSchema);
