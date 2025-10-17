// models/ApproveFlow.js
const mongoose = require("mongoose");

const ApproveFlowSchema = new mongoose.Schema({
  name: { type: String, required: true }, // ชื่อ flow เช่น "AE Flow" หรือ "Default Flow"
  approvalHierarchy: [
    {
      level: { type: Number, required: true },      // ลำดับการอนุมัติ
      approver: { type: String, required: true },   // อีเมลผู้อนุมัติในแต่ละลำดับ
      status: { type: String, default: "Pending" }, // สำหรับ template จะ default = Pending
      approvedAt: { type: Date, default: null },
    },
  ],
});

module.exports =
  mongoose.models.ApproveFlow ||
  mongoose.model("ApproveFlow", ApproveFlowSchema);

