const mongoose = require("mongoose");

const CompanySchema = new mongoose.Schema({
  companyName: { type: String, required: true },
  taxIdentification: { type: String, required: true },
  headOffice: { type: String, required: true },
  phoneNo: { type: String, required: true },
  address: { type: String, required: true },
  logoLink: { type: String },
});

module.exports = mongoose.model("Company", CompanySchema);
