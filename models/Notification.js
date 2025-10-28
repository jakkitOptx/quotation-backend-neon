// models/Notification.js
const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    // 🔹 email หรือ username ของผู้รับการแจ้งเตือน
    user: { type: String, required: true },

    // 🔹 ข้อความแจ้งเตือน เช่น "ใบเสนอราคา OPTX(M)-2025-002 ได้รับการอนุมัติแล้ว"
    message: { type: String, required: true },

    // 🔹 link ที่จะให้คลิกไปดูเอกสารได้ (optional)
    link: { type: String, default: null },

    // 🔹 ระบุประเภท เช่น approval / system / info (เพื่อแยกประเภทในอนาคต)
    type: {
      type: String,
      enum: ["approval", "system", "info"],
      default: "approval",
    },

    // 🔹 บอกว่าอ่านแล้วหรือยัง
    isRead: { type: Boolean, default: false },

    // 🔹 ใครเป็นผู้สร้าง (approver หรือ system)
    createdBy: { type: String, default: "system" },

    // 🔹 เก็บเวลา
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Notification", NotificationSchema);
