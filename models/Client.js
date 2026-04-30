// models/Client.js
const mongoose = require('mongoose');

const ClientSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  companyBaseName: { type: String, required: true },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    default: undefined,
  },
  authorizedApprovers: [
    {
      name: { type: String, trim: true, default: "" },
      email: {
        type: String,
        trim: true,
        lowercase: true,
        required: true,
      },
      position: { type: String, trim: true, default: "" },
    },
  ],
  address: { type: String, required: true },
  taxIdentificationNumber: { type: String, required: true }, // เปลี่ยนเป็น String
  contactPhoneNumber: { type: String, required: true }, // เปลี่ยนเป็น String
  branchNo: { type: String, required: true }
});

module.exports = mongoose.model('Client', ClientSchema);
