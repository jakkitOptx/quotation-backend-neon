const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const PurchaseRequest = require('../models/PurchaseRequest');
const User = require('../models/User');
const ApproveFlow = require('../models/ApproveFlow');
const { buildFlow, applyAction, applyEdit, applyCancel, canAct, accessFilter } = require('../services/purchaseRequestService');
const id = () => new mongoose.Types.ObjectId();
const managerId = id(), approverId = id(), adminId = id();
const neonAdminId = id();
process.env.PURCHASE_REQUEST_ADMIN_USER_ID = String(neonAdminId);
const natornId = id();
const mockNeonAdminExists = t => {
  t.mock.method(User, 'exists', async filter => (
    String(filter._id) === String(neonAdminId) ? { _id: neonAdminId } : null
  ));
  t.mock.method(User, 'findOne', filter => ({
    select: async () => (filter.username === 'natorn@neonworks.co.th' ? { _id: natornId, username: filter.username } : null),
  }));
};
const makeDoc = () => new PurchaseRequest({
  createdByUser: id(), preparedBy: 'Test User', managerName: 'Manager Test', documentDate: new Date(),
  purchaseReason: 'Other', otherReason: 'New equipment', urgency: 'High',
  requiredDate: new Date(), approvalFlowId: id(),
  items: [{ quantity: 1, description: 'Laptop' }],
  approvalSteps: [managerId, approverId, adminId].map((userId, index) => ({
    userId, role: ['manager', 'approver', 'admin'][index], name: 'Person', approver: 'person@example.com',
  })),
});

test('Other requires nonblank detail; item validation matches purchase form', async () => {
  const doc = makeDoc();
  await doc.validate();
  doc.otherReason = '   ';
  await assert.rejects(doc.validate(), /other purchase reason/);
  doc.otherReason = 'Replacement';
  doc.items[0].unitPrice = Infinity;
  await assert.rejects(doc.validate(), /unitPrice/);
  doc.items[0].unitPrice = null;
  doc.items[0].quantity = 0;
  await assert.rejects(doc.validate(), /quantity/);
  doc.items = [];
  await assert.rejects(doc.validate(), /At least one item/);
});

test('only current assignee acts and admin completes after final approval', async () => {
  const doc = makeDoc();
  assert.throws(() => applyAction(doc, { _id: approverId }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { _id: managerId }, { status: 'Approved' });
  assert.equal(doc.status, 'Pending');
  assert.throws(() => applyAction(doc, { _id: managerId }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { _id: approverId }, { status: 'Approved' });
  assert.equal(doc.status, 'Approved');
  applyAction(doc, { _id: adminId }, { status: 'Approved' });
  assert.equal(doc.status, 'Completed');
  await doc.validate();
  assert.throws(() => applyAction(doc, { _id: adminId }, { status: 'Completed' }), /already closed/);
});

test('rejection needs reason and closes the request', () => {
  const doc = makeDoc();
  assert.throws(() => applyAction(doc, { _id: managerId }, { status: 'Rejected', reason: ' ' }), /reason is required/);
  applyAction(doc, { _id: managerId }, { status: 'Rejected', reason: 'Over budget' });
  assert.equal(doc.status, 'Rejected');
  assert.equal(doc.approvalSteps[0].reason, 'Over budget');
  assert.throws(() => applyAction(doc, { _id: approverId }, { status: 'Approved' }), /already closed/);
});

test('display names do not trigger any account lookup; QT flow supplies actual assignees', async t => {
  const requester = { _id: id(), flow: id() };
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: requester.flow, approvalHierarchy: [
    { level: 5, approver: 'later@example.com', status: 'Approved' },
    { level: 2, approver: 'staff@example.com' },
    { level: 3, approver: 'HEAD@example.com' },
    { level: 4, approver: 'Natorn@neonworks.co.th' },
  ] }));
  t.mock.method(User, 'find', () => { throw new Error('Must not look up names'); });
  mockNeonAdminExists(t);
  const flow = await buildFlow(requester, 'กชลี สุริยะกำพล');
  assert.equal(flow.managerName, 'กชลี สุริยะกำพล');
  assert.equal(flow.finalApproverName, 'NATORN MANEEKORN');
  assert.equal(flow.adminName, 'SUREERAT JANHOM');
  assert.deepEqual(flow.approvalSteps.map(step => step.approver), [
    'head@example.com', 'natorn@neonworks.co.th', undefined,
  ]);
  assert.deepEqual(flow.approvalSteps.map(step => step.role), ['manager', 'approver', 'admin']);
  assert.equal(String(flow.approvalSteps[1].userId), String(natornId));
  assert.equal(flow.approvalSteps[1].level, 4);
  assert.ok(flow.approvalSteps.every(step => step.status === 'Pending'));
  assert.equal(String(flow.approvalSteps[2].userId), String(neonAdminId));
  assert.equal(flow.approvalSteps[2].identityName, undefined);
  const doc = makeDoc();
  doc.approvalSteps = flow.approvalSteps;
  await doc.validate();
  assert.throws(() => applyAction(doc, { _id: natornId }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { username: 'head@example.com' }, { status: 'Approved' });
  assert.equal(doc.status, 'Pending');
  // Natorn's step is bound to his user ID; the email alone does not grant it.
  assert.throws(() => applyAction(doc, { _id: id(), username: 'natorn@neonworks.co.th' }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { _id: natornId, username: 'natorn@neonworks.co.th' }, { status: 'Approved' });
  assert.equal(doc.status, 'Approved');
  assert.throws(() => applyAction(doc, { _id: id(), firstName: 'Other', lastName: 'Admin' }, { status: 'Approved' }), /current approver/);
  // Renaming an account to the admin's name must not grant the admin step.
  assert.throws(() => applyAction(doc, { _id: id(), firstName: 'Sureerat', lastName: 'Janhom' }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { _id: neonAdminId, firstName: 'Any', lastName: 'Name', username: 'admin@example.com' }, { status: 'Approved' });
  assert.equal(doc.status, 'Completed');
  assert.equal(doc.approvalSteps[2].actedBy, 'admin@example.com');
  await assert.rejects(buildFlow(requester, '  '), /managerName is required/);
  await assert.rejects(buildFlow(requester, { name: 'Manager Test' }), /managerName is required/);
});

test('participants can read by flow email or admin user ID, with escaped email matching', () => {
  const user = { _id: id(), username: 'A+B@example.com', firstName: 'SUREERAT', lastName: 'JANHOM' };
  const filter = accessFilter(user);
  assert.ok(!filter.$or.some(clause => 'approvalSteps.identityName' in clause), 'name must not grant read access');
  const adminFilter = accessFilter({ _id: neonAdminId, username: 'sureerat@neonworks.co.th' });
  assert.ok(adminFilter.$or.some(clause => String(clause['approvalSteps.userId']) === String(neonAdminId)));
  assert.ok(adminFilter.$or.some(clause => clause['approvalSteps.identityName'] === 'sureerat janhom'));
  const regex = filter.$or.find(clause => clause['approvalSteps.approver'])['approvalSteps.approver'];
  assert.ok(regex.test('a+b@example.com'));
  assert.ok(!regex.test('aaab@exampleXcom'));
  assert.ok(canAct({ approver: 'a+b@example.com' }, user));
  assert.ok(!canAct({ approver: 'other@example.com' }, user));
});

test('reported payload creates successfully without fixed-name or manager account records', async t => {
  const controller = require('../controllers/purchaseRequestController');
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy: [
    { level: 3, approver: 'manager@example.com' }, { level: 5, approver: 'final@example.com' },
  ] }));
  t.mock.method(User, 'find', () => { throw new Error('Unexpected account lookup'); });
  mockNeonAdminExists(t);
  t.mock.method(PurchaseRequest.prototype, 'save', async function() { await this.validate(); return this; });
  const body = { managerName: 'กชลี สุริยะกำพล', documentDate: '2026-11-25', purchaseReason: 'Lost', otherReason: '', assetCode: '32456', urgency: 'Medium', requiredDate: '2026-12-01', items: [{ quantity: 1, description: 'เมาส์', unitPrice: 333, note: '' }] };
  let code, result;
  const res = { status(value) { code = value; return this; }, json(value) { result = value; } };
  await controller.create({ body, user: { _id: id(), flow: id(), firstName: 'Test', lastName: 'User' } }, res);
  assert.equal(code, 201);
  assert.equal(result.managerName, body.managerName);
  assert.equal(result.adminName, 'SUREERAT JANHOM');
  assert.equal(result.items[0].description, 'เมาส์');
});

test('OPTX uses CHAWACHAI labels and the same QT level 5 account approves final and admin separately', async t => {
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy: [
    { level: 5, approver: 'Chawachai@optxfi.com' },
    { level: 3, approver: 'manager@optxfi.com' },
  ] }));
  t.mock.method(User, 'find', () => { throw new Error('Must not look up fixed names'); });
  mockNeonAdminExists(t);
  for (const requester of [
    { company: ' optx ', username: 'requester@example.com' },
    { company: 'OPTXFI', username: 'requester@example.com' },
    { username: 'requester@optxfi.com' },
  ]) {
    const flow = await buildFlow({ ...requester, flow: id() }, 'หัวหน้า แผนก');
    assert.equal(flow.company, 'OPTX');
    assert.equal(flow.finalApproverName, 'CHAWACHAI WICHAIDIT');
    assert.equal(flow.adminName, 'CHAWACHAI WICHAIDIT');
    assert.equal(flow.approvalSteps[2].approver, 'chawachai@optxfi.com');
    assert.ok(!canAct(flow.approvalSteps[2], { firstName: 'SUREERAT', lastName: 'JANHOM' }));
    const doc = makeDoc();
    Object.assign(doc, flow);
    const chawachai = { username: 'chawachai@optxfi.com' };
    assert.throws(() => applyAction(doc, chawachai, { status: 'Approved' }), /current approver/);
    applyAction(doc, { username: 'manager@optxfi.com' }, { status: 'Approved' });
    applyAction(doc, chawachai, { status: 'Approved' });
    assert.equal(doc.status, 'Approved');
    assert.equal(doc.approvalSteps[2].status, 'Pending');
    applyAction(doc, chawachai, { status: 'Approved' });
    assert.equal(doc.status, 'Completed');
    await doc.validate();
    const filter = accessFilter(chawachai);
    assert.ok(filter.$or.some(clause => clause['approvalSteps.approver']?.test('chawachai@optxfi.com')));
  }
  for (const company of ['neon', 'NEONWORKS']) {
    const flow = await buildFlow({ company, username: 'requester@optxfi.com', flow: id() }, 'หัวหน้า แผนก');
    assert.equal(flow.company, 'NEONWORKS');
    assert.equal(flow.finalApproverName, 'NATORN MANEEKORN');
    assert.equal(flow.adminName, 'SUREERAT JANHOM');
  }
});

test('OPTX requires an unambiguous level 5 account in its QT flow', async t => {
  let approvalHierarchy = [{ level: 3, approver: 'manager@example.com' }];
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy }));
  const requester = { company: 'OPTX', flow: id() };
  await assert.rejects(buildFlow(requester, 'Manager Name'), /exactly one level 5/);
  approvalHierarchy = [{ level: 5, approver: 'one@example.com' }, { level: 5, approver: 'two@example.com' }];
  await assert.rejects(buildFlow(requester, 'Manager Name'), /exactly one level 5/);
});

test('NEONWORKS admin requires a configured, existing account ID', async t => {
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy: [{ level: 3, approver: 'manager@example.com' }] }));
  mockNeonAdminExists(t);
  const requester = { company: 'NEONWORKS', flow: id() };
  const original = process.env.PURCHASE_REQUEST_ADMIN_USER_ID;
  try {
    for (const value of [undefined, '', 'not-an-id', String(id())]) {
      if (value === undefined) delete process.env.PURCHASE_REQUEST_ADMIN_USER_ID;
      else process.env.PURCHASE_REQUEST_ADMIN_USER_ID = value;
      await assert.rejects(buildFlow(requester, 'Manager Name'), /admin account is not configured/);
    }
  } finally {
    process.env.PURCHASE_REQUEST_ADMIN_USER_ID = original;
  }
});

test('legacy name-assigned admin steps are authorized by the configured account ID only', () => {
  const step = { role: 'admin', identityName: 'sureerat janhom' };
  assert.ok(canAct(step, { _id: neonAdminId, firstName: 'Renamed', lastName: 'Account' }));
  assert.ok(!canAct(step, { _id: id(), firstName: 'Sureerat', lastName: 'Janhom' }));
  assert.ok(!canAct({ role: 'admin', identityName: 'someone else' }, { _id: neonAdminId }));
});

test('NEONWORKS supervisor falls back when Natorn is missing or first in the QT flow', async t => {
  let approvalHierarchy;
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy }));
  mockNeonAdminExists(t);
  const requester = { company: 'NEONWORKS', flow: id() };
  approvalHierarchy = [{ level: 3, approver: 'lead@example.com' }, { level: 4, approver: 'head@example.com' }];
  let flow = await buildFlow(requester, 'Manager Name');
  assert.deepEqual(flow.approvalSteps.map(step => [step.role, step.approver]), [
    ['manager', 'head@example.com'], ['approver', 'natorn@neonworks.co.th'], ['admin', undefined],
  ]);
  assert.equal(flow.approvalSteps[1].level, undefined);
  approvalHierarchy = [{ level: 3, approver: 'natorn@neonworks.co.th' }, { level: 4, approver: 'head@example.com' }];
  flow = await buildFlow(requester, 'Manager Name');
  assert.deepEqual(flow.approvalSteps.map(step => step.role), ['approver', 'admin']);
});

test('NEONWORKS creation fails when the Natorn account does not exist', async t => {
  t.mock.method(ApproveFlow, 'findById', async () => ({ _id: id(), approvalHierarchy: [{ level: 3, approver: 'lead@example.com' }] }));
  mockNeonAdminExists(t);
  t.mock.method(User, 'findOne', () => ({ select: async () => null }));
  await assert.rejects(buildFlow({ company: 'NEONWORKS', flow: id() }, 'Manager Name'), /final approver account is not configured/);
});

test('creator edits an untouched request; others and in-progress requests are refused', async () => {
  const doc = makeDoc();
  const creator = { _id: doc.createdByUser };
  assert.throws(() => applyEdit(doc, { _id: managerId }, { urgency: 'Low' }), err => err.status === 403);
  assert.throws(() => applyEdit(doc, creator, {}), /at least one/);
  assert.throws(() => applyEdit(doc, creator, { managerName: '  ' }), /managerName is required/);
  applyEdit(doc, creator, {
    urgency: 'Low', managerName: ' New Manager ', status: 'Completed', approvalSteps: [], createdByUser: id(),
    items: [{ quantity: 2, description: 'Mouse', unitPrice: 300, extra: 'ignored' }],
  });
  await doc.validate();
  assert.equal(doc.urgency, 'Low');
  assert.equal(doc.managerName, 'New Manager');
  assert.equal(doc.status, 'Pending');
  assert.equal(doc.approvalSteps.length, 3);
  assert.equal(String(doc.createdByUser), String(creator._id));
  assert.equal(doc.items[0].quantity, 2);
  applyEdit(doc, creator, { items: [] });
  await assert.rejects(doc.validate(), /At least one item/);
  applyEdit(doc, creator, { items: [{ quantity: 1, description: 'Laptop' }] });
  applyAction(doc, { _id: managerId }, { status: 'Approved' });
  assert.throws(() => applyEdit(doc, creator, { urgency: 'High' }), err => err.status === 409);
  assert.throws(() => applyCancel(doc, creator), err => err.status === 409);
});

test('rejected request can be edited and resubmitted with rejection history kept', async () => {
  const doc = makeDoc();
  const creator = { _id: doc.createdByUser };
  applyAction(doc, { _id: managerId }, { status: 'Approved' });
  applyAction(doc, { _id: approverId }, { status: 'Rejected', reason: 'Too expensive' });
  applyEdit(doc, creator, { items: [{ quantity: 1, description: 'Cheaper laptop', unitPrice: 15000 }] });
  await doc.validate();
  assert.equal(doc.status, 'Pending');
  assert.ok(doc.resubmittedAt instanceof Date);
  assert.ok(doc.approvalSteps.every(step => step.status === 'Pending' && !step.actedAt && !step.reason));
  assert.equal(doc.rejectionHistory.length, 1);
  assert.equal(doc.rejectionHistory[0].reason, 'Too expensive');
  assert.equal(doc.rejectionHistory[0].role, 'approver');
  // Approval restarts from the first step.
  assert.throws(() => applyAction(doc, { _id: approverId }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { _id: managerId }, { status: 'Approved' });
  assert.equal(doc.approvalSteps[0].status, 'Approved');
});

test('creator cancels untouched or rejected requests; cancelled requests are closed', async () => {
  const doc = makeDoc();
  const creator = { _id: doc.createdByUser };
  assert.throws(() => applyCancel(doc, { _id: adminId }), err => err.status === 403);
  applyCancel(doc, creator);
  await doc.validate();
  assert.equal(doc.status, 'Cancelled');
  assert.ok(doc.cancelledAt instanceof Date);
  assert.throws(() => applyAction(doc, { _id: managerId }, { status: 'Approved' }), /already closed/);
  assert.throws(() => applyEdit(doc, creator, { urgency: 'Low' }), err => err.status === 409);
  assert.throws(() => applyCancel(doc, creator), err => err.status === 409);
  const rejected = makeDoc();
  applyAction(rejected, { _id: managerId }, { status: 'Rejected', reason: 'No budget' });
  applyCancel(rejected, { _id: rejected.createdByUser });
  assert.equal(rejected.status, 'Cancelled');
  const completed = makeDoc();
  for (const userId of [managerId, approverId, adminId]) applyAction(completed, { _id: userId }, { status: 'Approved' });
  assert.throws(() => applyCancel(completed, { _id: completed.createdByUser }), err => err.status === 409);
});

test('update and delete routes are wired to the controller', () => {
  const router = require('../routes/purchaseRequestRoutes');
  const routes = router.stack.filter(layer => layer.route).map(layer => `${Object.keys(layer.route.methods)[0]} ${layer.route.path}`);
  assert.ok(routes.includes('patch /:id'));
  assert.ok(routes.includes('delete /:id'));
  assert.ok(routes.includes('patch /:id/approval'));
});
