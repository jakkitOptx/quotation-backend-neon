// models/MeetingRoom.js
const mongoose = require("mongoose");

const MeetingRoomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true }, // R1, R2, R3
    name: { type: String, required: true },
    floor: { type: Number, required: true },
    capacity: { type: Number, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MeetingRoom", MeetingRoomSchema);
