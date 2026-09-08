const Quotation = require("../models/Quotation");
const Client = require("../models/Client");
const Handover = require("../models/Handover");
const { canViewQuotation, canEditQuotation } = require("../utils/quotationAccess");
const { normalizePayload, sourceFields, id } = require("../utils/handover");

async function quotationFor(req, write = false) {
  id(req.params.id, "quotationId");
  const quotation = await Quotation.findById(req.params.id);
  if (!quotation) throw Object.assign(new Error("Quotation not found"), { status: 404 });
  if (!canViewQuotation(req.user, quotation) || (write && !canEditQuotation(req.user, quotation))) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }
  if (quotation.approvalStatus !== "Approved") {
    throw Object.assign(new Error("Only approved quotations can use handovers"), { status: 409 });
  }
  return quotation;
}

const endpoint = (handler) => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    const status = error.status || (error.code === 11000 ? 409 : error.name === "ValidationError" ? 400 : 500);
    if (status === 500) console.error("Handover error:", error);
    res.status(status).json({ message: status === 500 ? "Unable to process handover" : error.code === 11000 ? "Handover already exists; retry the request" : error.message });
  }
};

exports.defaults = endpoint(async (req, res) => {
  const quotation = await quotationFor(req, true);
  res.json({
    quotationId: quotation._id,
    template: "pattern1",
    ...sourceFields(quotation, req.user),
    completionPercentage: 100,
    remainingPercentage: 0,
    expectedCompletionMonth: null,
    remarkEnabled: false,
    remark: "",
    additionalRecipientEnabled: false,
    clientOptionsEndpoint: "/api/clients",
  });
});

exports.get = endpoint(async (req, res) => {
  await quotationFor(req);
  const handover = await Handover.findOne({ quotationId: req.params.id });
  if (!handover) return res.status(404).json({ message: "Handover not found" });
  res.json(handover);
});

exports.save = endpoint(async (req, res) => {
  const quotation = await quotationFor(req, true);
  const payload = normalizePayload(req.body);
  const sources = sourceFields(quotation, req.user);
  const ids = [...new Set([payload.hiringClientId, payload.deliveredToClientId, payload.sender.clientId, ...payload.recipients.map(p => p.clientId)])];
  const clients = await Client.find({ _id: { $in: ids } }).select("customerName").lean();
  const byId = new Map(clients.map(c => [String(c._id), c]));
  const company = (clientId) => {
    const record = byId.get(clientId.toLowerCase());
    if (!record) throw Object.assign(new Error(`Client not found: ${clientId}`), { status: 400 });
    return { clientId: record._id, companyName: record.customerName };
  };
  const signer = ({ name, position, clientId }) => ({ name, position, company: company(clientId) });
  const { hiringClientId, deliveredToClientId, sender, recipients, ...values } = payload;
  const handover = await Handover.findOneAndUpdate(
    { quotationId: quotation._id },
    {
      $set: {
        ...values, ...sources, template: "pattern1",
        hiringClient: company(hiringClientId), deliveredToClient: company(deliveredToClientId),
        sender: signer(sender), recipients: recipients.map(signer), updatedBy: req.user._id,
      },
      $setOnInsert: { quotationId: quotation._id, createdBy: req.user._id },
    },
    { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
  );
  res.json(handover);
});
