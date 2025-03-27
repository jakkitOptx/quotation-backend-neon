// models/ApprovalTemplate.js
const mongoose = require("mongoose");

const ApprovalTemplateSchema = new mongoose.Schema(
  {
    templateId: { type: String, required: true, unique: true },
    createdBy: { type: String, required: true },
    approvalHierarchy: [
      {
        level: { type: Number, required: true },
        approver: { type: String, required: true },
        status: { type: String, enum: ["Pending", "Approved", "Rejected"], default: "Pending" },
        approvedAt: { type: Date, default: null },
        remark: { type: String, default: null },
      },
    ],
  },
  { timestamps: true } // ใช้ timestamps อัตโนมัติ
);

module.exports = mongoose.model("ApprovalTemplate", ApprovalTemplateSchema);

