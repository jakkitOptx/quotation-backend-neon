// models/MeetingRoom.js
const mongoose = require("mongoose");

const MeetingRoomSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    floor: { type: Number, required: true },
    capacity: { type: Number, required: true },
    capacityLabel: { type: String, default: "" },
    sortOrder: { type: Number, default: 0 },
    isComingSoon: { type: Boolean, default: false },
    comingSoonMessage: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("MeetingRoom", MeetingRoomSchema);
