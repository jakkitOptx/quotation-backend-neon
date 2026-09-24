const mongoose = require("mongoose");
const requiredText = { type: String, required: true };
const client = new mongoose.Schema({
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: true },
  companyName: requiredText,
}, { _id: false });
const person = new mongoose.Schema({
  name: requiredText,
  position: requiredText,
  company: { type: client, required: true },
}, { _id: false });
const recipient = new mongoose.Schema({
  name: { type: String, default: "" },
  position: { type: String, default: "" },
  company: { type: client, required: true },
}, { _id: false });

const schema = new mongoose.Schema({
  quotationId: { type: mongoose.Schema.Types.ObjectId, ref: "Quotation", required: true, unique: true },
  template: { type: String, enum: ["pattern1"], default: "pattern1" },
  documentDate: { type: Date, required: true },
  issuerCompany: { code: requiredText, name: requiredText },
  projectName: requiredText,
  quotationNumber: requiredText,
  quotationType: requiredText,
  workType: requiredText,
  hiringClient: { type: client, required: true },
  deliveredToClient: { type: client, required: true },
  completionPercentage: { type: Number, min: 0, max: 100, required: true },
  remainingPercentage: { type: Number, min: 0, max: 100, required: true },
  expectedCompletionMonth: { type: String, default: null },
  sender: { type: person, required: true },
  recipients: { type: [recipient], required: true },
  additionalRecipientEnabled: { type: Boolean, required: true },
  remarkEnabled: { type: Boolean, required: true },
  remark: { type: String, default: "" },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });

module.exports = mongoose.model("Handover", schema);
