const { test } = require("node:test");
const assert = require("node:assert/strict");

const periodAccessPath = require.resolve("../services/timesheetPeriodAccessService");
const auditPath = require.resolve("../services/timesheetAuditService");

require.cache[periodAccessPath] = {
  id: periodAccessPath,
  filename: periodAccessPath,
  loaded: true,
  exports: {
    getTimesheetPeriodAccess: async () => ({ canEdit: true }),
  },
};
require.cache[auditPath] = {
  id: auditPath,
  filename: auditPath,
  loaded: true,
  exports: { logTimesheetActivity: async () => {} },
};

const Client = require("../models/Client");
const TimesheetProject = require("../models/TimesheetProject");
const TimesheetEntry = require("../models/TimesheetEntry");
const { createEntry } = require("../controllers/timesheetController");

test("POST entry updates an existing project/date entry instead of returning 409", async () => {
  const originals = {
    clientFindById: Client.findById,
    projectFindOne: TimesheetProject.findOne,
    entryFindOne: TimesheetEntry.findOne,
    entryFindOneAndUpdate: TimesheetEntry.findOneAndUpdate,
  };
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const clientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";
  const entryId = "dddddddddddddddddddddddd";
  const workDate = new Date("2026-09-20T17:00:00.000Z");

  Client.findById = () => ({
    select: () => ({ lean: async () => ({ _id: clientId }) }),
  });
  TimesheetProject.findOne = () => ({
    select: () => ({
      lean: async () => ({ _id: projectId, clientId, isActive: true }),
    }),
  });
  TimesheetEntry.findOne = () => ({
    select: () => ({ lean: async () => ({ _id: entryId }) }),
  });
  TimesheetEntry.findOneAndUpdate = async (query, update, options) => {
    assert.equal(String(query._id), entryId);
    assert.equal(String(query.userId), userId);
    assert.equal(update.$set.hours, 6);
    assert.equal(String(update.$set.clientId), clientId);
    assert.equal(options.new, true);
    assert.equal(options.runValidators, true);
    const data = {
      _id: entryId,
      userId,
      clientId,
      projectId,
      workDate,
      hours: 6,
    };
    return { ...data, toObject: () => data };
  };

  const req = {
    body: { clientId, projectId, workDate: "2026-09-21", hours: 6 },
    user: { _id: userId, username: "user@example.com" },
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
  };

  try {
    await createEntry(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.reused, true);
    assert.equal(res.data.updated, true);
    assert.equal(res.data.data.hours, 6);
    assert.equal(res.data.data.workDate, "2026-09-21");
  } finally {
    Client.findById = originals.clientFindById;
    TimesheetProject.findOne = originals.projectFindOne;
    TimesheetEntry.findOne = originals.entryFindOne;
    TimesheetEntry.findOneAndUpdate = originals.entryFindOneAndUpdate;
  }
});
