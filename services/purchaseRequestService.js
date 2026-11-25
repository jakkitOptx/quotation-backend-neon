const ApproveFlow = require('../models/ApproveFlow');
const normalize = value => String(value || '').trim().toLowerCase();
const fullName = user => `${user.firstName} ${user.lastName}`.trim();
const normalizeName = value => normalize(value).replace(/\s+/g, ' ');
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function requesterCompany(user) {
  const company = normalize(user.company);
  if (['optx', 'optxfi'].includes(company)) return 'OPTX';
  if (['neon', 'neonworks'].includes(company)) return 'NEONWORKS';
  // Older accounts may have no company; follow the existing email convention.
  return /@optx(?:fi)?\./i.test(normalize(user.username)) ? 'OPTX' : 'NEONWORKS';
}

async function buildFlow(user, managerName) {
  if (typeof managerName !== 'string' || !managerName.trim()) fail('managerName is required');
  const flow = user.flow && await ApproveFlow.findById(user.flow);
  if (!flow) fail('QT approval flow is not configured for this user');
  // Names on the form are labels. Actual assignees come from the QT flow,
  // whose approver field is the account username/email, without User lookups.
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
  const adminAssignment = isOptx
    ? { approver: normalize(optxFinalSteps[0].approver), level: 5 }
    : { identityName: 'sureerat janhom' };
  return {
    company,
    managerName: managerName.trim(),
    finalApproverName,
    adminName,
    approvalFlowId: flow._id,
    approvalSteps: [...hierarchy.map((step, index) => ({
      role: index === hierarchy.length - 1 ? 'approver' : 'manager',
      name: normalize(step.approver),
      approver: normalize(step.approver),
      level: step.level,
      status: 'Pending',
    })), {
      role: 'admin', name: adminName, ...adminAssignment, status: 'Pending',
    }],
  };
}

function canAct(step, user) {
  if (!step) return false;
  // Existing records may still be assigned by User ID.
  if (step.userId) return String(step.userId) === String(user._id);
  if (step.identityName) return normalizeName(step.identityName) === normalizeName(fullName(user));
  return !!normalize(step.approver) && normalize(step.approver) === normalize(user.username);
}

function accessFilter(user) {
  const escapedUsername = normalize(user.username).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const participants = [
    { createdByUser: user._id }, { 'approvalSteps.userId': user._id },
    { 'approvalSteps.identityName': normalizeName(fullName(user)) },
  ];
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

module.exports = { buildFlow, applyAction, fullName, canAct, accessFilter };
