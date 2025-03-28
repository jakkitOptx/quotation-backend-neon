// models/Client.js
const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  companyBaseName: { type: String, required: true },
  address: { type: String, required: true },
  taxIdentificationNumber: { type: String, required: true }, // เปลี่ยนเป็น String
  contactPhoneNumber: { type: String, required: true }, // เปลี่ยนเป็น String
  branchNo: { type: String, required: true }
});

module.exports = mongoose.model('Client', ClientSchema);
