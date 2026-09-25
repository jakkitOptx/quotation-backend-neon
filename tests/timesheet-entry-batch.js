const { test } = require("node:test");
const assert = require("node:assert/strict");

let periodAccessCalls = 0;
const periodAccessPath = require.resolve("../services/timesheetPeriodAccessService");
const auditPath = require.resolve("../services/timesheetAuditService");
require.cache[periodAccessPath] = {
  id: periodAccessPath,
  filename: periodAccessPath,
  loaded: true,
  exports: {
    getTimesheetPeriodAccess: async () => {
      periodAccessCalls += 1;
      return { canEdit: true };
    },
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
const { saveEntriesBatch } = require("../controllers/timesheetController");

test("batch saves multiple dates with one bulk write", async () => {
  const originals = {
    clientFindById: Client.findById,
    projectFindOne: TimesheetProject.findOne,
    entryFind: TimesheetEntry.find,
    entryBulkWrite: TimesheetEntry.bulkWrite,
  };
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const clientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";
  const project = { _id: projectId, clientId, name: "Campaign", isActive: true };
  const client = { _id: clientId, customerName: "Client" };
  let capturedOperations = [];

  periodAccessCalls = 0;
  Client.findById = () => ({
    select: () => ({ lean: async () => ({ _id: clientId }) }),
  });
  TimesheetProject.findOne = () => ({
    select: () => ({ lean: async () => project }),
  });
  TimesheetEntry.bulkWrite = async (operations, options) => {
    capturedOperations = operations;
    assert.equal(options.ordered, true);
    return { upsertedCount: 2, deletedCount: 0 };
  };
  TimesheetEntry.find = () => ({
    sort() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => [
      {
        _id: "dddddddddddddddddddddddd",
        userId,
        clientId: client,
        projectId: project,
        workDate: new Date("2026-09-20T17:00:00.000Z"),
        hours: 4,
      },
      {
        _id: "eeeeeeeeeeeeeeeeeeeeeeee",
        userId,
        clientId: client,
        projectId: project,
        workDate: new Date("2026-09-21T17:00:00.000Z"),
        hours: 5,
      },
    ],
  });

  const req = {
    body: {
      entries: [
        { clientId, projectId, workDate: "2026-09-21", hours: 4 },
        { clientId, projectId, workDate: "2026-09-22", hours: 5 },
      ],
      deleteEntryIds: [],
    },
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
    await saveEntriesBatch(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(capturedOperations.length, 2);
    assert.equal(capturedOperations[0].updateOne.upsert, true);
    assert.equal(periodAccessCalls, 1);
    assert.equal(res.data.createdCount, 2);
    assert.equal(res.data.updatedCount, 0);
    assert.equal(res.data.deletedCount, 0);
    assert.equal(res.data.data.length, 2);
  } finally {
    Client.findById = originals.clientFindById;
    TimesheetProject.findOne = originals.projectFindOne;
    TimesheetEntry.find = originals.entryFind;
    TimesheetEntry.bulkWrite = originals.entryBulkWrite;
  }
});
