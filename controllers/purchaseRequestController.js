const mongoose = require('mongoose');
const PurchaseRequest = require('../models/PurchaseRequest');
const { buildFlow, applyAction, applyEdit, applyCancel, mapItems, fullName, accessFilter } = require('../services/purchaseRequestService');
const handle = fn => async (req, res) => {
  try { await fn(req, res); } catch (error) {
    const status = error.name === 'VersionError' ? 409 :
      ['ValidationError', 'CastError'].includes(error.name) ? 400 : error.status || 500;
    res.status(status).json({ message: status === 500 ? 'Purchase request operation failed' : error.message });
  }
};
const load = async req => {
  if (!mongoose.isValidObjectId(req.params.id)) throw Object.assign(new Error('Invalid request ID'), { status: 400 });
  const doc = await PurchaseRequest.findOne({ _id: req.params.id, ...accessFilter(req.user) });
  if (!doc) throw Object.assign(new Error('Purchase request not found'), { status: 404 });
  return doc;
};

exports.create = handle(async (req, res) => {
  const body = req.body;
  const flow = await buildFlow(req.user, body.managerName);
  const doc = new PurchaseRequest({
    createdByUser: req.user._id,
    preparedBy: fullName(req.user), position: req.user.position, department: req.user.department,
    documentDate: body.documentDate || new Date(),
    purchaseReason: body.purchaseReason, otherReason: body.otherReason,
    assetCode: body.assetCode, urgency: body.urgency, requiredDate: body.requiredDate,
    items: mapItems(body.items),
    ...flow,
  });
  await doc.save();
  res.status(201).json(doc);
});
exports.list = handle(async (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 20));
  const filter = accessFilter(req.user);
  const [items, total] = await Promise.all([
    PurchaseRequest.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
    PurchaseRequest.countDocuments(filter),
  ]);
  res.json({ items, total, page, limit });
});
exports.get = handle(async (req, res) => res.json(await load(req)));
exports.act = handle(async (req, res) => {
  const doc = await load(req);
  applyAction(doc, req.user, req.body);
  await doc.save();
  res.json(doc);
});
exports.update = handle(async (req, res) => {
  const doc = await load(req);
  applyEdit(doc, req.user, req.body);
  await doc.save();
  res.json(doc);
});
exports.cancel = handle(async (req, res) => {
  const doc = await load(req);
  applyCancel(doc, req.user);
  await doc.save();
  res.json(doc);
});
