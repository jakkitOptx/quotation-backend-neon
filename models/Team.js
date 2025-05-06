const mongoose = require("mongoose");

const TeamSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // เช่น "AE 1", "Media 2"
  group: { type: String, required: true }, // เช่น "AE", "Media"
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Team", TeamSchema);
