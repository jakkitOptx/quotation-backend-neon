const { companiesByEmailDomain, workTypes } = require("../config/handover");

const fail = (message) => { const error = new Error(message); error.status = 400; throw error; };
const text = (value, field, max = 300) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${field} is required (maximum ${max} characters)`);
  return value.trim();
};
const id = (value, field) => {
  if (typeof value !== "string" || !/^[a-f\d]{24}$/i.test(value)) fail(`${field} must be a valid ID`);
  return value;
};
const flag = (value, field) => {
  if (typeof value !== "boolean") fail(`${field} must be a boolean`);
  return value;
};
const person = (value, field) => ({
  name: text(value?.name, `${field}.name`),
  position: text(value?.position, `${field}.position`),
  clientId: id(value?.clientId, `${field}.clientId`),
});

function normalizePayload(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("Invalid request body");
  const percentage = body.completionPercentage;
  if (typeof percentage !== "number" || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) fail("completionPercentage must be a number between 0 and 100");
  if (Math.abs(percentage * 100 - Math.round(percentage * 100)) > 1e-8) fail("completionPercentage supports at most 2 decimal places");
  let expectedCompletionMonth = null;
  if (percentage < 100) {
    if (typeof body.expectedCompletionMonth !== "string" || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(body.expectedCompletionMonth)) fail("expectedCompletionMonth is required as YYYY-MM when completion is below 100");
    expectedCompletionMonth = body.expectedCompletionMonth;
  }
  const documentDate = body.documentDate;
  if (typeof documentDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(documentDate) || !Number.isFinite(Date.parse(documentDate)) || new Date(documentDate).toISOString().slice(0, 10) !== documentDate) fail("documentDate must be a valid YYYY-MM-DD date");
  const remarkEnabled = flag(body.remarkEnabled, "remarkEnabled");
  const additionalRecipientEnabled = flag(body.additionalRecipientEnabled, "additionalRecipientEnabled");
  if (!Array.isArray(body.recipients) || body.recipients.length !== (additionalRecipientEnabled ? 2 : 1)) fail("recipients must contain 1 person, or 2 when additionalRecipientEnabled is true");
  return {
    documentDate,
    hiringClientId: id(body.hiringClientId, "hiringClientId"),
    deliveredToClientId: id(body.deliveredToClientId, "deliveredToClientId"),
    completionPercentage: percentage,
    remainingPercentage: Math.round((100 - percentage) * 100) / 100,
    expectedCompletionMonth,
    sender: person(body.sender, "sender"),
    recipients: body.recipients.map((value, i) => person(value, `recipients[${i}]`)),
    additionalRecipientEnabled,
    remarkEnabled,
    remark: remarkEnabled ? text(body.remark, "remark", 5000) : "",
  };
}

function sourceFields(quotation, user) {
  const email = String(user.username || user.email || "").trim().toLowerCase();
  const issuerCompany = companiesByEmailDomain[email.split("@")[1]];
  if (!issuerCompany) fail("No handover company mapping configured for login email domain");
  const workType = workTypes[quotation.type];
  if (!workType) fail(`No handover work type mapping configured for ${quotation.type}`);
  const prefix = quotation.createdByUser?.includes("@optx") ? "OPTX" : "NW-QT";
  return {
    issuerCompany: { ...issuerCompany },
    projectName: quotation.projectName,
    quotationType: quotation.type,
    workType,
    quotationNumber: `${prefix}(${quotation.type})-${new Date(quotation.documentDate).getFullYear()}-${String(quotation.runNumber).padStart(3, "0")}`,
  };
}

module.exports = { normalizePayload, sourceFields, id };
