const mongoose = require("mongoose");

const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // เช่น "Media"
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Department", DepartmentSchema);
