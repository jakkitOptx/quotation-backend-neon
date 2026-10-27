const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const socketCalls = [];
const socketPath = require.resolve("../services/socketNotificationService");
const auditPath = require.resolve("../services/timesheetAuditService");
const periodAccessPath = require.resolve("../services/timesheetPeriodAccessService");
require.cache[socketPath] = {
  id: socketPath,
  filename: socketPath,
  loaded: true,
  exports: {
    sendSocketNotification: async (to, title, message) => {
      socketCalls.push({ to, title, message });
    },
  },
};
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: { logTimesheetActivity: async () => {} },
};
require.cache[periodAccessPath] = {
  id: periodAccessPath,
  filename: periodAccessPath,
  loaded: true,
  exports: { getTimesheetPeriodAccess: async () => ({ canEdit: true, canSubmit: true }) },
};

const Notification = require("../models/Notification");
const User = require("../models/User");
const TimesheetSubmission = require("../models/TimesheetSubmission");
const {
  TIMESHEET_NOTIFICATION_EVENTS,
  notifySubmissionCreated,
  notifySubmissionApproved,
  notifySubmissionRejected,
  removeSubmissionNotifications,
} = require("../services/timesheetNotificationService");
const timesheetController = require("../controllers/timesheetController");
const notificationController = require("../controllers/notificationController");
const notificationRoutes = require("../routes/notificationRoutes");

const submitterId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const submissionId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const submitter = {
  _id: submitterId,
  username: "Staff@neonworks.co.th",
  firstName: "Somchai",
  lastName: "Jaidee",
};
const managerOne = { _id: "cccccccccccccccccccccccc", username: "lead@neonworks.co.th", firstName: "Lead" };
const managerTwo = { _id: "dddddddddddddddddddddddd", username: "Head@neonworks.co.th" };

const buildSubmission = (overrides = {}) => ({
  _id: submissionId,
  userId: submitterId,
  periodStart: new Date("2026-10-18T17:00:00.000Z"),
  periodEnd: new Date("2026-10-24T17:00:00.000Z"),
  totalHours: 40,
  status: "pending",
  currentApprovalLevel: 1,
  approvalSteps: [
    { level: 1, approverUsername: managerOne.username, status: "pending" },
    { level: 2, approverUsername: managerTwo.username, status: "waiting" },
  ],
  ...overrides,
});

const stubNotificationWrites = () => {
  const originals = {
    insertMany: Notification.insertMany,
    updateMany: Notification.updateMany,
    deleteMany: Notification.deleteMany,
    userFindById: User.findById,
  };
  const captured = { inserted: [], updates: [], deletes: [] };

  socketCalls.length = 0;
  Notification.insertMany = async (docs) => {
    captured.inserted.push(...docs);
    return docs;
  };
  Notification.updateMany = async (filter, update) => {
    captured.updates.push({ filter, update });
    return { modifiedCount: 1 };
  };
  Notification.deleteMany = async (filter) => {
    captured.deletes.push(filter);
    return { deletedCount: 1 };
  };
  User.findById = () => ({ lean: async () => submitter });

  const restore = () => {
    Notification.insertMany = originals.insertMany;
    Notification.updateMany = originals.updateMany;
    Notification.deleteMany = originals.deleteMany;
    User.findById = originals.userFindById;
  };

  return { captured, restore };
};

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

test("submission notifies the current ApproveFlow approver only", async () => {
  const { captured, restore } = stubNotificationWrites();
  try {
    await notifySubmissionCreated({ submission: buildSubmission(), submitter });

    assert.equal(captured.inserted.length, 1);
    const [notification] = captured.inserted;
    assert.equal(notification.user, "lead@neonworks.co.th");
    assert.equal(notification.module, "timesheet");
    assert.equal(notification.event, TIMESHEET_NOTIFICATION_EVENTS.pending);
    assert.equal(notification.entityId, submissionId);
    assert.equal(notification.link, `/timesheets/approvals/${submissionId}`);
    assert.equal(notification.createdBy, "staff@neonworks.co.th");
    assert.match(notification.message, /Somchai Jaidee/);
    assert.match(notification.message, /2026-10-19 - 2026-10-25/);
    assert.deepEqual(socketCalls.map((call) => call.to), ["lead@neonworks.co.th"]);
  } finally {
    restore();
  }
});

test("intermediate approval notifies submitter and the next approver", async () => {
  const { captured, restore } = stubNotificationWrites();
  try {
    const submission = buildSubmission({
      currentApprovalLevel: 2,
      approvalSteps: [
        { level: 1, approverUsername: managerOne.username, status: "approved" },
        { level: 2, approverUsername: managerTwo.username, status: "pending" },
      ],
    });
    await notifySubmissionApproved({ submission, approver: managerOne, level: 1 });

    assert.equal(captured.updates.length, 1);
    assert.equal(captured.updates[0].filter.user, "lead@neonworks.co.th");
    assert.equal(captured.updates[0].filter.event, TIMESHEET_NOTIFICATION_EVENTS.pending);
    assert.equal(captured.updates[0].update.$set.isRead, true);

    assert.deepEqual(
      captured.inserted.map((item) => [item.user, item.event]),
      [
        ["staff@neonworks.co.th", TIMESHEET_NOTIFICATION_EVENTS.approved],
        ["head@neonworks.co.th", TIMESHEET_NOTIFICATION_EVENTS.pending],
      ]
    );
    assert.deepEqual(
      captured.inserted.map((item) => item.link),
      ["/timesheets/dashboard", `/timesheets/approvals/${submissionId}`]
    );
  } finally {
    restore();
  }
});

test("final approval notifies only the submitter", async () => {
  const { captured, restore } = stubNotificationWrites();
  try {
    const submission = buildSubmission({
      status: "approved",
      currentApprovalLevel: null,
      approvalSteps: [
        { level: 1, approverUsername: managerOne.username, status: "approved" },
        { level: 2, approverUsername: managerTwo.username, status: "approved" },
      ],
    });
    await notifySubmissionApproved({ submission, approver: managerTwo, level: 2 });

    assert.deepEqual(
      captured.inserted.map((item) => [item.user, item.event]),
      [["staff@neonworks.co.th", TIMESHEET_NOTIFICATION_EVENTS.fullyApproved]]
    );
  } finally {
    restore();
  }
});

test("rejection notifies the submitter with the reason", async () => {
  const { captured, restore } = stubNotificationWrites();
  try {
    const submission = buildSubmission({ status: "rejected", currentApprovalLevel: null });
    await notifySubmissionRejected({ submission, approver: managerOne, reason: "Missing Friday" });

    assert.equal(captured.inserted.length, 1);
    assert.equal(captured.inserted[0].user, "staff@neonworks.co.th");
    assert.equal(captured.inserted[0].event, TIMESHEET_NOTIFICATION_EVENTS.rejected);
    assert.match(captured.inserted[0].message, /Missing Friday/);
    assert.equal(captured.inserted[0].link, "/timesheets/dashboard");
  } finally {
    restore();
  }
});

test("withdrawal removes the submission's notifications", async () => {
  const { captured, restore } = stubNotificationWrites();
  try {
    await removeSubmissionNotifications(submissionId);
    assert.deepEqual(captured.deletes, [{ module: "timesheet", entityId: submissionId }]);
  } finally {
    restore();
  }
});

test("notification failures do not throw into the Timesheet action", async () => {
  const { restore } = stubNotificationWrites();
  const originalError = console.error;
  Notification.insertMany = async () => {
    throw new Error("db down");
  };
  console.error = () => {};
  try {
    const result = await notifySubmissionCreated({ submission: buildSubmission(), submitter });
    assert.equal(result, null);
  } finally {
    console.error = originalError;
    restore();
  }
});

test("withdrawSubmission deletes recipients' notifications", async () => {
  const { captured, restore } = stubNotificationWrites();
  const originalFindOne = TimesheetSubmission.findOne;
  const doc = {
    ...buildSubmission(),
    async save() {},
    toObject() {
      return { ...this };
    },
  };
  TimesheetSubmission.findOne = async () => doc;

  try {
    const res = createResponse();
    await timesheetController.withdrawSubmission(
      { params: { id: submissionId }, user: submitter },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(doc.status, "withdrawn");
    assert.deepEqual(captured.deletes, [{ module: "timesheet", entityId: submissionId }]);
  } finally {
    TimesheetSubmission.findOne = originalFindOne;
    restore();
  }
});

test("bell list is scoped to the signed-in user", async () => {
  const originals = { find: Notification.find, countDocuments: Notification.countDocuments };
  let listFilter = null;
  const countFilters = [];
  Notification.find = (filter) => {
    listFilter = filter;
    return {
      sort() {
        return this;
      },
      skip() {
        return this;
      },
      limit() {
        return this;
      },
      lean: async () => [
        { _id: "eeeeeeeeeeeeeeeeeeeeeeee", message: "hello", isRead: false, module: "timesheet" },
      ],
    };
  };
  Notification.countDocuments = async (filter) => {
    countFilters.push(filter);
    return filter.isRead === false ? 1 : 3;
  };

  try {
    const res = createResponse();
    await notificationController.getMyNotifications(
      { user: submitter, query: { module: "timesheet", limit: "500" } },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.deepEqual(listFilter, {
      user: { $in: ["Staff@neonworks.co.th", "staff@neonworks.co.th"] },
      module: "timesheet",
    });
    assert.equal(res.body.unreadCount, 1);
    assert.equal(res.body.pagination.limit, 100);
    assert.equal(res.body.pagination.total, 3);
    assert.equal(countFilters[1].isRead, false);

    const invalid = createResponse();
    await notificationController.getMyNotifications(
      { user: submitter, query: { module: "payroll" } },
      invalid
    );
    assert.equal(invalid.statusCode, 400);
  } finally {
    Notification.find = originals.find;
    Notification.countDocuments = originals.countDocuments;
  }
});

test("users cannot mark another user's notification as read", async () => {
  const originalFindOneAndUpdate = Notification.findOneAndUpdate;
  let capturedFilter = null;
  Notification.findOneAndUpdate = (filter) => {
    capturedFilter = filter;
    return { lean: async () => null };
  };

  try {
    const res = createResponse();
    await notificationController.markNotificationRead(
      { user: managerOne, params: { id: "eeeeeeeeeeeeeeeeeeeeeeee" } },
      res
    );

    assert.equal(res.statusCode, 404);
    assert.deepEqual(capturedFilter.user, { $in: ["lead@neonworks.co.th"] });

    const invalid = createResponse();
    await notificationController.markNotificationRead(
      { user: managerOne, params: { id: "not-an-id" } },
      invalid
    );
    assert.equal(invalid.statusCode, 400);
  } finally {
    Notification.findOneAndUpdate = originalFindOneAndUpdate;
  }
});

test("notification routes require authentication", async () => {
  const app = express();
  app.use("/api/notifications", notificationRoutes);
  const server = app.listen(0);

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notifications/unread-count`);
    assert.equal(response.status, 401);
  } finally {
    server.close();
  }
});
