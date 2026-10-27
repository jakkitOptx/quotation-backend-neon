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
    readAt: { type: Date, default: null },

    // 🔹 หัวข้อสั้นๆ สำหรับแสดงใน dropdown ระฆัง (optional)
    title: { type: String, default: "" },

    // 🔹 module ต้นทาง เช่น "timesheet" (แจ้งเตือนใบเสนอราคาเดิมไม่มีค่านี้ = null)
    module: { type: String, default: null },

    // 🔹 เหตุการณ์ เช่น submission_pending / submission_approved / submission_rejected
    event: { type: String, default: null },

    // 🔹 id ของเอกสารต้นทาง (เช่น TimesheetSubmission) ใช้ลบ/อ่านแจ้งเตือนตามเอกสาร
    entityId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // 🔹 ใครเป็นผู้สร้าง (approver หรือ system)
    createdBy: { type: String, default: "system" },

    // 🔹 เก็บเวลา
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Bell dropdown and unread badge read by recipient, newest first.
NotificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
NotificationSchema.index({ module: 1, entityId: 1 });

module.exports =
  mongoose.models.Notification ||
  mongoose.model("Notification", NotificationSchema);
