const mongoose = require('mongoose');
const ApproveFlow = require('../models/ApproveFlow');
const User = require('../models/User');
const normalize = value => String(value || '').trim().toLowerCase();
const fullName = user => `${user.firstName} ${user.lastName}`.trim();
const normalizeName = value => normalize(value).replace(/\s+/g, ' ');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const LEGACY_NEON_ADMIN_IDENTITY = 'sureerat janhom';
// NEONWORKS requests are always approved by this account.
const NEON_FINAL_APPROVER_USERNAME = 'natorn@neonworks.co.th';

// NEONWORKS admin step is authorized by account ID, never by display name,
// because users can edit their own first/last name.
function neonAdminUserId() {
  const value = String(process.env.PURCHASE_REQUEST_ADMIN_USER_ID || '').trim();
  return mongoose.isValidObjectId(value) ? value : null;
}
const isNeonAdmin = user => !!neonAdminUserId() && String(user?._id) === neonAdminUserId();

function requesterCompany(user) {
  const company = normalize(user.company);
  if (['optx', 'optxfi'].includes(company)) return 'OPTX';
  if (['neon', 'neonworks'].includes(company)) return 'NEONWORKS';
  // Older accounts may have no company; follow the existing email convention.
  return /@optx(?:fi)?\./i.test(normalize(user.username)) ? 'OPTX' : 'NEONWORKS';
}

const toStep = (step, role) => ({
  role, name: normalize(step.approver), approver: normalize(step.approver), level: step.level, status: 'Pending',
});

// NEONWORKS: supervisor = the QT step just before Natorn (or the last QT step when
// Natorn is not in the flow), then Natorn bound by user ID. OPTX keeps the full QT flow.
async function buildNeonQtSteps(hierarchy) {
  const finalUser = await User.findOne({ username: NEON_FINAL_APPROVER_USERNAME }).select('_id username');
  if (!finalUser) fail('NEONWORKS purchase request final approver account is not configured');
  const finalIndex = hierarchy.findIndex(step => normalize(step.approver) === NEON_FINAL_APPROVER_USERNAME);
  const supervisor = finalIndex === -1 ? hierarchy[hierarchy.length - 1] : hierarchy[finalIndex - 1];
  return [
    ...(supervisor && normalize(supervisor.approver) !== NEON_FINAL_APPROVER_USERNAME ? [toStep(supervisor, 'manager')] : []),
    {
      role: 'approver', name: NEON_FINAL_APPROVER_USERNAME, approver: NEON_FINAL_APPROVER_USERNAME,
      userId: finalUser._id, ...(finalIndex === -1 ? {} : { level: hierarchy[finalIndex].level }), status: 'Pending',
    },
  ];
}

async function buildFlow(user, managerName) {
  if (typeof managerName !== 'string' || !managerName.trim()) fail('managerName is required');
  const flow = user.flow && await ApproveFlow.findById(user.flow);
  if (!flow) fail('QT approval flow is not configured for this user');
  // Names on the form are labels. Actual assignees come from the QT flow,
  // whose approver field is the account username/email (NEONWORKS also pins Natorn by user ID).
  const hierarchy = [...(flow.approvalHierarchy || [])].sort((a, b) => a.level - b.level);
  if (!hierarchy.length || hierarchy.some(step => !normalize(step.approver) || !Number.isFinite(step.level))) {
    fail('QT approval flow must contain valid approvers');
  }
  const company = requesterCompany(user);
  const isOptx = company === 'OPTX';
  const finalApproverName = isOptx ? 'CHAWACHAI WICHAIDIT' : 'NATORN MANEEKORN';
  const adminName = isOptx ? 'CHAWACHAI WICHAIDIT' : 'SUREERAT JANHOM';
  const optxFinalSteps = hierarchy.filter(step => step.level === 5);
  if (isOptx && optxFinalSteps.length !== 1) fail('OPTX QT approval flow must contain exactly one level 5 approver');
  let adminAssignment;
  let qtSteps;
  if (isOptx) {
    adminAssignment = { approver: normalize(optxFinalSteps[0].approver), level: 5 };
    qtSteps = hierarchy.map((step, index) => toStep(step, index === hierarchy.length - 1 ? 'approver' : 'manager'));
  } else {
    const adminUserId = neonAdminUserId();
    if (!adminUserId || !await User.exists({ _id: adminUserId })) {
      fail('NEONWORKS purchase request admin account is not configured');
    }
    adminAssignment = { userId: adminUserId };
    qtSteps = await buildNeonQtSteps(hierarchy);
  }
  return {
    company,
    managerName: managerName.trim(),
    finalApproverName,
    adminName,
    approvalFlowId: flow._id,
    approvalSteps: [...qtSteps, {
      role: 'admin', name: adminName, ...adminAssignment, status: 'Pending',
    }],
  };
}

function canAct(step, user) {
  if (!step) return false;
  // Existing records may still be assigned by User ID.
  if (step.userId) return String(step.userId) === String(user._id);
  // Legacy NEONWORKS records stored the admin by name; authorize them by the configured account ID.
  if (step.identityName) return normalizeName(step.identityName) === LEGACY_NEON_ADMIN_IDENTITY && isNeonAdmin(user);
  return !!normalize(step.approver) && normalize(step.approver) === normalize(user.username);
}

function accessFilter(user) {
  const escapedUsername = normalize(user.username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const participants = [{ createdByUser: user._id }, { 'approvalSteps.userId': user._id }];
  if (isNeonAdmin(user)) participants.push({ 'approvalSteps.identityName': LEGACY_NEON_ADMIN_IDENTITY });
  if (escapedUsername) participants.push({ 'approvalSteps.approver': new RegExp(`^\\s*${escapedUsername}\\s*$`, 'i') });
  return { $or: participants };
}

function applyAction(doc, user, body) {
  if (!['Pending', 'Approved'].includes(doc.status)) fail('Request is already closed', 409);
  const step = doc.approvalSteps.find(item => item.status === 'Pending');
  if (!canAct(step, user)) fail('Only the current approver can act', 403);
  const allowed = step.role === 'admin' ? ['Approved', 'Rejected', 'Completed'] : ['Approved', 'Rejected'];
  if (!allowed.includes(body.status)) fail(`Status must be ${allowed.join(' or ')}`);
  if (body.status === 'Rejected' && !String(body.reason || '').trim()) fail('Rejection reason is required');
  if (step.role === 'admin' && body.expectedDeliveryDate != null) {
    if (!body.expectedDeliveryDate || !Number.isFinite(Date.parse(body.expectedDeliveryDate))) fail('Invalid expected delivery date');
    doc.expectedDeliveryDate = new Date(body.expectedDeliveryDate);
  }
  step.status = body.status === 'Completed' ? 'Approved' : body.status;
  step.actedAt = new Date();
  step.actedBy = normalize(user.username);
  step.reason = String(body.reason || '').trim();
  doc.status = body.status === 'Rejected' ? 'Rejected' : step.role === 'admin' ? 'Completed' : step.role === 'approver' ? 'Approved' : 'Pending';
}

const EDITABLE_FIELDS = ['managerName', 'documentDate', 'purchaseReason', 'otherReason', 'assetCode', 'urgency', 'requiredDate', 'items'];
const mapItems = items => (Array.isArray(items) ? items.map(item => ({
  quantity: item?.quantity, description: item?.description, unitPrice: item?.unitPrice, note: item?.note,
})) : []);

// Creator may change a request before anyone has acted on it, or after it was rejected.
function assertCreatorCanChange(doc, user, action) {
  if (String(doc.createdByUser) !== String(user._id)) fail(`Only the creator can ${action} this request`, 403);
  const untouched = doc.status === 'Pending' && doc.approvalSteps.every(step => step.status === 'Pending');
  if (!untouched && doc.status !== 'Rejected') {
    fail(`Request can only be ${action === 'edit' ? 'edited' : 'cancelled'} before approval starts or after rejection`, 409);
  }
}

function applyEdit(doc, user, body = {}) {
  assertCreatorCanChange(doc, user, 'edit');
  if (!EDITABLE_FIELDS.some(field => Object.hasOwn(body, field))) fail(`Provide at least one of: ${EDITABLE_FIELDS.join(', ')}`);
  if (Object.hasOwn(body, 'managerName')) {
    if (typeof body.managerName !== 'string' || !body.managerName.trim()) fail('managerName is required');
    doc.managerName = body.managerName.trim();
  }
  for (const field of ['documentDate', 'purchaseReason', 'otherReason', 'assetCode', 'urgency', 'requiredDate']) {
    if (Object.hasOwn(body, field)) doc[field] = body[field];
  }
  if (Object.hasOwn(body, 'items')) doc.items = mapItems(body.items);
  if (doc.status === 'Rejected') {
    // Resubmit: keep the rejection on record, then restart the same approval steps.
    for (const step of doc.approvalSteps.filter(item => item.status === 'Rejected')) {
      doc.rejectionHistory.push({
        role: step.role, approver: step.approver, name: step.name, reason: step.reason, actedAt: step.actedAt, actedBy: step.actedBy,
      });
    }
    for (const step of doc.approvalSteps) {
      step.status = 'Pending';
      step.actedAt = undefined;
      step.actedBy = undefined;
      step.reason = undefined;
    }
    doc.status = 'Pending';
    doc.expectedDeliveryDate = undefined;
    doc.resubmittedAt = new Date();
  }
}

function applyCancel(doc, user) {
  assertCreatorCanChange(doc, user, 'cancel');
  doc.status = 'Cancelled';
  doc.cancelledAt = new Date();
}

module.exports = { buildFlow, applyAction, applyEdit, applyCancel, mapItems, fullName, canAct, accessFilter };
