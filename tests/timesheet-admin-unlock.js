const { test } = require("node:test");
const assert = require("node:assert/strict");

const auditCalls = [];
let periodAccess = { isExpired: false, isReopened: false };

const stubModule = (relativePath, exports) => {
  const resolved = require.resolve(relativePath);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
stubModule("../services/socketNotificationService", {
  sendSocketNotification: async () => {},
});
stubModule("../services/timesheetAuditService", {
  logTimesheetActivity: async (entry) => {
    auditCalls.push(entry);
  },
});
stubModule("../services/timesheetPeriodAccessService", {
  getTimesheetPeriodAccess: async () => periodAccess,
});

const Notification = require("../models/Notification");
const User = require("../models/User");
const TimesheetSubmission = require("../models/TimesheetSubmission");
const TimesheetPeriodOverride = require("../models/TimesheetPeriodOverride");
const ApproveFlow = require("../models/ApproveFlow");
const { TIMESHEET_NOTIFICATION_EVENTS } = require("../services/timesheetNotificationService");
const timesheetController = require("../controllers/timesheetController");
const { getThailandDateKey, parseWorkDate, formatWorkDate } = require("../utils/timesheet");

const ownerId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const submissionId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const admin = { _id: "cccccccccccccccccccccccc", username: "admin@neonworks.co.th", firstName: "Admin", role: "admin" };
const staff = { _id: ownerId, username: "staff@neonworks.co.th", firstName: "Somchai", lastName: "Jaidee", role: "user" };

const buildSubmission = (overrides = {}) => ({
  _id: submissionId,
  userId: ownerId,
  periodType: "week",
  periodStart: new Date("2026-10-18T17:00:00.000Z"),
  periodEnd: new Date("2026-10-24T17:00:00.000Z"),
  totalHours: 40,
  status: "approved",
  currentApprovalLevel: null,
  approvedAt: new Date("2026-10-26T03:00:00.000Z"),
  approvalSteps: [{ level: 1, approverUsername: "lead@neonworks.co.th", status: "approved" }],
  ...overrides,
});

const createResponse = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

// Replaces model statics for one test and returns a restore function.
const stub = (target, methods) => {
  const originals = Object.fromEntries(Object.keys(methods).map((key) => [key, target[key]]));
  Object.assign(target, methods);
  return () => Object.assign(target, originals);
};

const stubUnlockWrites = ({ submission = buildSubmission(), updated } = {}) => {
  const captured = { submissionUpdates: [], overrideUpserts: [], overrideCloses: [], notifications: [] };
  const restores = [
    stub(TimesheetSubmission, {
      findById: () => ({ lean: async () => submission }),
      findOneAndUpdate: async (filter, update) => {
        captured.submissionUpdates.push({ filter, update });
        if (updated === null) {
          return null;
        }
        const doc = { ...submission, ...update.$set };
        return { ...doc, toObject: () => doc };
      },
    }),
    stub(TimesheetPeriodOverride, {
      updateMany: async (filter, update) => {
        captured.overrideCloses.push({ filter, update });
        return { modifiedCount: 0 };
      },
      findOneAndUpdate: async (filter, update, options) => {
        captured.overrideUpserts.push({ filter, update, options });
        return { reopenUntil: update.$max.reopenUntil };
      },
    }),
    stub(Notification, {
      insertMany: async (docs) => {
        captured.notifications.push(...docs);
        return docs;
      },
    }),
    stub(User, { findById: () => ({ lean: async () => staff }) }),
  ];
  auditCalls.length = 0;
  periodAccess = { isExpired: false, isReopened: false };
  return { captured, restore: () => restores.forEach((restore) => restore()) };
};

test("admin unlock endpoints reject non-admin users", async () => {
  const listRes = createResponse();
  await timesheetController.getAdminApprovedSubmissions({ user: staff, query: {} }, listRes);
  assert.equal(listRes.statusCode, 403);

  const unlockRes = createResponse();
  await timesheetController.unlockApprovedSubmission(
    { user: staff, params: { id: submissionId }, body: { reason: "wrong hours" } },
    unlockRes
  );
  assert.equal(unlockRes.statusCode, 403);
});

test("approved submission list filters by user, period and search with pagination", async () => {
  let capturedQuery = null;
  let capturedSort = null;
  let capturedSkip = null;
  let userSearch = null;
  const chain = {
    sort(value) {
      capturedSort = value;
      return this;
    },
    skip(value) {
      capturedSkip = value;
      return this;
    },
    limit() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => [buildSubmission({ userId: staff })],
  };
  const restore = [
    stub(TimesheetSubmission, {
      find: (query) => {
        capturedQuery = query;
        return chain;
      },
      countDocuments: async () => 21,
    }),
    stub(User, {
      find: (filter) => {
        userSearch = filter;
        return { lean: async () => [{ _id: ownerId }, { _id: "dddddddddddddddddddddddd" }] };
      },
    }),
  ];

  try {
    const res = createResponse();
    await timesheetController.getAdminApprovedSubmissions(
      {
        user: admin,
        query: { userId: ownerId, from: "2026-10-01", to: "2026-10-31", search: "somchai", page: "2", limit: "20" },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(capturedQuery.status, "approved");
    assert.deepEqual(capturedQuery.userId, { $in: [ownerId] });
    assert.ok(capturedQuery.periodStart.$lt instanceof Date);
    assert.ok(capturedQuery.periodEnd.$gte instanceof Date);
    assert.equal(userSearch.$or.length, 4);
    assert.equal(capturedSort.approvedAt, -1);
    assert.equal(capturedSkip, 20);
    assert.deepEqual(res.body.pagination, { page: 2, limit: 20, total: 21, totalPages: 2 });

    const [row] = res.body.data;
    assert.equal(row.userId, ownerId);
    assert.equal(row.user.displayName, "Somchai Jaidee");
    assert.equal(row.periodStart, "2026-10-19");
    assert.equal(row.canUnlock, true);
  } finally {
    restore.forEach((fn) => fn());
  }
});

test("level 3 approvers only see their ApproveFlow subordinates and cannot unlock", async () => {
  const head = { _id: "eeeeeeeeeeeeeeeeeeeeeeee", username: "head@neonworks.co.th", role: "manager", level: 3 };
  const outsiderId = "ffffffffffffffffffffffff";
  const capturedQueries = [];
  let flowFilter = null;
  const chain = {
    sort() {
      return this;
    },
    skip() {
      return this;
    },
    limit() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => [buildSubmission({ userId: staff })],
  };
  const restore = [
    stub(TimesheetSubmission, {
      find: (query) => {
        capturedQueries.push(query);
        return chain;
      },
      countDocuments: async () => 1,
    }),
    stub(ApproveFlow, {
      find: (filter) => {
        flowFilter = filter;
        return { lean: async () => [{ _id: "111111111111111111111111" }] };
      },
    }),
    stub(User, { find: () => ({ lean: async () => [{ _id: ownerId }] }) }),
  ];

  try {
    const lowLevel = createResponse();
    await timesheetController.getAdminApprovedSubmissions(
      { user: { ...head, level: 2 }, query: {} },
      lowLevel
    );
    assert.equal(lowLevel.statusCode, 403);

    const res = createResponse();
    await timesheetController.getAdminApprovedSubmissions({ user: head, query: {} }, res);
    assert.equal(res.statusCode, 200);
    assert.match(flowFilter["approvalHierarchy.approver"].$regex, /head@neonworks/);
    assert.deepEqual(capturedQueries[0].userId, { $in: [ownerId] });
    assert.equal(res.body.data[0].canUnlock, false);

    const outsider = createResponse();
    await timesheetController.getAdminApprovedSubmissions(
      { user: head, query: { userId: outsiderId } },
      outsider
    );
    assert.deepEqual(capturedQueries[1].userId, { $in: [] });

    const unlock = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: head, params: { id: submissionId }, body: { reason: "wrong hours" } },
      unlock
    );
    assert.equal(unlock.statusCode, 403);
  } finally {
    restore.forEach((fn) => fn());
  }
});

test("approved submission list validates status and page size", async () => {
  const badStatus = createResponse();
  await timesheetController.getAdminApprovedSubmissions(
    { user: admin, query: { status: "pending" } },
    badStatus
  );
  assert.equal(badStatus.statusCode, 400);

  const badLimit = createResponse();
  await timesheetController.getAdminApprovedSubmissions(
    { user: admin, query: { limit: "500" } },
    badLimit
  );
  assert.equal(badLimit.statusCode, 400);
});

test("unlock requires a reason and an approved submission", async () => {
  const { restore } = stubUnlockWrites({ submission: buildSubmission({ status: "pending" }) });
  try {
    const noReason = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: admin, params: { id: submissionId }, body: { reason: "  " } },
      noReason
    );
    assert.equal(noReason.statusCode, 400);

    const notApproved = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: admin, params: { id: submissionId }, body: { reason: "wrong hours" } },
      notApproved
    );
    assert.equal(notApproved.statusCode, 409);
  } finally {
    restore();
  }
});

test("unlock moves an approved submission to unlocked with audit and owner notification", async () => {
  const { captured, restore } = stubUnlockWrites();
  try {
    const res = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: admin, params: { id: submissionId }, body: { reason: "กรอกชั่วโมงผิด" } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.status, "unlocked");
    assert.equal(res.body.data.reopenUntil, null);

    const [{ filter, update }] = captured.submissionUpdates;
    assert.deepEqual(filter, { _id: submissionId, status: "approved" });
    assert.equal(update.$set.status, "unlocked");
    assert.equal(update.$set.unlockedBy, admin._id);
    assert.equal(update.$set.unlockReason, "กรอกชั่วโมงผิด");
    assert.ok(update.$set.unlockedAt instanceof Date);
    assert.equal(captured.overrideUpserts.length, 0);

    assert.equal(auditCalls.length, 1);
    assert.equal(auditCalls[0].action, "submission_unlocked");
    assert.equal(auditCalls[0].actor, admin.username);
    assert.equal(auditCalls[0].metadata.reason, "กรอกชั่วโมงผิด");

    assert.equal(captured.notifications.length, 1);
    assert.equal(captured.notifications[0].user, staff.username);
    assert.equal(captured.notifications[0].event, TIMESHEET_NOTIFICATION_EVENTS.unlocked);
    assert.match(captured.notifications[0].message, /กรอกชั่วโมงผิด/);
  } finally {
    restore();
  }
});

test("unlocking a period past its deadline also reopens it", async () => {
  const { captured, restore } = stubUnlockWrites();
  periodAccess = { isExpired: true, isReopened: false };
  try {
    const res = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: admin, params: { id: submissionId }, body: { reason: "wrong project" } },
      res
    );

    assert.equal(res.statusCode, 200);
    const [{ filter, update, options }] = captured.overrideUpserts;
    assert.equal(filter.isActive, true);
    assert.equal(filter.periodType, "week");
    assert.equal(options.upsert, true);
    assert.equal(update.$setOnInsert.reopenedBy, admin._id);

    const expected = new Date(parseWorkDate(getThailandDateKey()).getTime() + 7 * 24 * 60 * 60 * 1000);
    assert.equal(res.body.data.reopenUntil, formatWorkDate(expected));
    assert.equal(auditCalls[0].metadata.reopenUntil, formatWorkDate(expected));
  } finally {
    restore();
  }
});

test("unlock reports a conflict when the submission changed concurrently", async () => {
  const { captured, restore } = stubUnlockWrites({ updated: null });
  try {
    const res = createResponse();
    await timesheetController.unlockApprovedSubmission(
      { user: admin, params: { id: submissionId }, body: { reason: "wrong hours" } },
      res
    );

    assert.equal(res.statusCode, 409);
    assert.equal(auditCalls.length, 0);
    assert.equal(captured.notifications.length, 0);
  } finally {
    restore();
  }
});
