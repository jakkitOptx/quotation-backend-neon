// models/MeetingRoomBooking.js
const mongoose = require("mongoose");

const MeetingRoomBookingSchema = new mongoose.Schema(
  {
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MeetingRoom",
      required: true,
      index: true,
    },
    dateKey: { type: String, required: true, index: true }, // YYYY-MM-DD

    // เก็บเป็นนาทีเพื่อเช็คชนง่าย
    startMin: { type: Number, required: true, index: true },
    endMin: { type: Number, required: true, index: true },

    // เก็บเวลาแบบ string ไว้ใช้แสดงผล/UI
    startTime: { type: String, required: true }, // "13:30"
    endTime: { type: String, required: true }, // "14:00"

    purpose: { type: String, default: "-" },

    createdByUser: { type: String, default: null }, // username
    createdByEmail: { type: String, default: null }, // email
  },
  { timestamps: true }
);

// ช่วยเร่ง query ตามห้อง+วัน
MeetingRoomBookingSchema.index({ roomId: 1, dateKey: 1 });

module.exports = mongoose.model("MeetingRoomBooking", MeetingRoomBookingSchema);
