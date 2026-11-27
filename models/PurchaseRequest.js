const mongoose = require('mongoose');

const stepSchema = new mongoose.Schema({
  role: { type: String, enum: ['manager', 'approver', 'admin'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, required: true },
  approver: String,
  identityName: String,
  level: Number,
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  actedAt: Date,
  actedBy: String,
  reason: String,
}, { _id: false });

const schema = new mongoose.Schema({
  createdByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  preparedBy: { type: String, required: true },
  company: { type: String, enum: ['OPTX', 'NEONWORKS'] },
  managerName: { type: String, trim: true },
  finalApproverName: { type: String, default: 'NATORN MANEEKORN' },
  adminName: { type: String, default: 'SUREERAT JANHOM' },
  position: String,
  department: String,
  documentDate: { type: Date, required: true },
  purchaseReason: { type: String, enum: ['Lost', 'Damaged', 'OutOfStock', 'Other'], required: true },
  otherReason: { type: String, trim: true, default: '' },
  assetCode: { type: String, trim: true, default: '' },
  urgency: { type: String, enum: ['High', 'Medium', 'Low'], required: true },
  requiredDate: { type: Date, required: true },
  items: [{
    quantity: { type: Number, required: true, min: Number.MIN_VALUE, validate: Number.isFinite },
    description: { type: String, required: true, trim: true },
    unitPrice: { type: Number, min: 0, default: null, validate: value => value == null || Number.isFinite(value) },
    note: { type: String, trim: true, default: '' },
  }],
  approvalFlowId: { type: mongoose.Schema.Types.ObjectId, ref: 'ApproveFlow', required: true },
  approvalSteps: { type: [stepSchema], required: true },
  status: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Completed', 'Cancelled'], default: 'Pending' },
  expectedDeliveryDate: Date,
  // Rejections kept when the creator edits and resubmits a rejected request.
  rejectionHistory: [{
    role: String, approver: String, name: String, reason: String, actedAt: Date, actedBy: String,
    _id: false,
  }],
  resubmittedAt: Date,
  cancelledAt: Date,
}, { timestamps: true, optimisticConcurrency: true });

schema.pre('validate', function(next) {
  if (this.purchaseReason === 'Other' && !this.otherReason?.trim()) {
    this.invalidate('otherReason', 'Please specify the other purchase reason');
  }
  if (!this.items?.length) this.invalidate('items', 'At least one item is required');
  next();
});
schema.index({ createdByUser: 1, createdAt: -1 });
schema.index({ 'approvalSteps.userId': 1, status: 1 });
schema.index({ 'approvalSteps.approver': 1, status: 1 });
schema.index({ 'approvalSteps.identityName': 1, status: 1 });
module.exports = mongoose.model('PurchaseRequest', schema);
