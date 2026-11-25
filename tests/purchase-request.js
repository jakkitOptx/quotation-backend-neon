const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const PurchaseRequest = require('../models/PurchaseRequest');
const User = require('../models/User');
const ApproveFlow = require('../models/ApproveFlow');
const { buildFlow, applyAction, canAct, accessFilter } = require('../services/purchaseRequestService');
const id = () => new mongoose.Types.ObjectId();
const managerId = id(), approverId = id(), adminId = id();
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
    { level: 5, approver: 'FINAL@example.com', status: 'Approved' },
    { level: 3, approver: 'manager@example.com' },
    { level: 4, approver: 'head@example.com' },
  ] }));
  t.mock.method(User, 'find', () => { throw new Error('Must not look up names'); });
  const flow = await buildFlow(requester, 'กชลี สุริยะกำพล');
  assert.equal(flow.managerName, 'กชลี สุริยะกำพล');
  assert.equal(flow.finalApproverName, 'NATORN MANEEKORN');
  assert.equal(flow.adminName, 'SUREERAT JANHOM');
  assert.deepEqual(flow.approvalSteps.map(step => step.approver), [
    'manager@example.com', 'head@example.com', 'final@example.com', undefined,
  ]);
  assert.ok(flow.approvalSteps.every(step => step.status === 'Pending'));
  const doc = makeDoc();
  doc.approvalSteps = flow.approvalSteps;
  await doc.validate();
  assert.throws(() => applyAction(doc, { username: 'final@example.com' }, { status: 'Approved' }), /current approver/);
  for (const username of ['manager@example.com', 'head@example.com', 'FINAL@example.com']) {
    applyAction(doc, { username }, { status: 'Approved' });
  }
  assert.equal(doc.status, 'Approved');
  assert.throws(() => applyAction(doc, { firstName: 'Other', lastName: 'Admin' }, { status: 'Approved' }), /current approver/);
  applyAction(doc, { firstName: 'Sureerat', lastName: 'Janhom', username: 'admin@example.com' }, { status: 'Approved' });
  assert.equal(doc.status, 'Completed');
  assert.equal(doc.approvalSteps[3].actedBy, 'admin@example.com');
  await assert.rejects(buildFlow(requester, '  '), /managerName is required/);
  await assert.rejects(buildFlow(requester, { name: 'Manager Test' }), /managerName is required/);
});

test('participants can read by flow email or admin name, with escaped email matching', () => {
  const user = { _id: id(), username: 'A+B@example.com', firstName: 'SUREERAT', lastName: 'JANHOM' };
  const filter = accessFilter(user);
  assert.ok(filter.$or.some(clause => clause['approvalSteps.identityName'] === 'sureerat janhom'));
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
