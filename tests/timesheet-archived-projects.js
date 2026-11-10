const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getWeeklyPeriod } = require("../utils/timesheet");

let periodCanEdit = false;
const periodAccessPath = require.resolve("../services/timesheetPeriodAccessService");
require.cache[periodAccessPath] = {
  id: periodAccessPath,
  filename: periodAccessPath,
  loaded: true,
  exports: {
    getTimesheetPeriodAccess: async ({ periodStart }) => {
      const period = getWeeklyPeriod(periodStart);
      return {
        periodStart: period.periodStartKey,
        periodEnd: period.periodEndKey,
        canEdit: periodCanEdit,
        canSubmit: periodCanEdit,
      };
    },
  },
};

const TimesheetEntry = require("../models/TimesheetEntry");
const TimesheetSubmission = require("../models/TimesheetSubmission");
const { getOverview } = require("../controllers/timesheetController");

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});

test("overview retains archived Projects and their historical hours", async () => {
  const originalAggregate = TimesheetEntry.aggregate;
  const originalEntryFind = TimesheetEntry.find;
  const originalSubmissionFind = TimesheetSubmission.find;
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const clientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";
  let capturedPipeline;

  TimesheetEntry.aggregate = async (pipeline) => {
    capturedPipeline = pipeline;
    return [
      {
        _id: {
          userId,
          clientId,
          projectId,
          workDate: new Date("2026-10-25T17:00:00.000Z"),
        },
        username: "user@example.com",
        department: "",
        clientName: "Client",
        projectName: "Archived Project",
        projectRemark: "Historical work",
        projectIsActive: false,
        dayHours: 5,
      },
    ];
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
        clientId: { _id: clientId, customerName: "Client" },
        projectId: {
          _id: projectId,
          name: "Archived Project",
          isActive: false,
        },
        workDate: new Date("2026-10-25T17:00:00.000Z"),
        hours: 5,
      },
    ],
  });
  TimesheetSubmission.find = () => ({
    sort() {
      return this;
    },
    lean: async () => [],
  });

  const res = createResponse();
  try {
    await getOverview(
      {
        query: { from: "2026-10-26", to: "2026-11-01" },
        user: { _id: userId },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.summary.totalHours, 5);
    assert.equal(res.data.summary.clients[0].projects[0].isActive, false);
    assert.equal(res.data.entries.length, 1);
    assert.equal(res.data.entries[0].hours, 5);
    assert.equal(
      capturedPipeline.some(
        (stage) => stage.$match?.["project.isActive"] === true
      ),
      false
    );
  } finally {
    TimesheetEntry.aggregate = originalAggregate;
    TimesheetEntry.find = originalEntryFind;
    TimesheetSubmission.find = originalSubmissionFind;
  }
});

test("overview hides an archived Project from an editable period", async () => {
  const originalAggregate = TimesheetEntry.aggregate;
  const originalEntryFind = TimesheetEntry.find;
  const originalSubmissionFind = TimesheetSubmission.find;
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const clientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";

  periodCanEdit = true;
  TimesheetEntry.aggregate = async () => [
    {
      _id: {
        userId,
        clientId,
        projectId,
        workDate: new Date("2026-11-08T17:00:00.000Z"),
      },
      username: "user@example.com",
      department: "",
      clientName: "Client",
      projectName: "Archived Project",
      projectRemark: "",
      projectIsActive: false,
      dayHours: 5,
    },
  ];
  TimesheetEntry.find = () => ({
    sort() { return this; },
    populate() { return this; },
    lean: async () => [
      {
        _id: "dddddddddddddddddddddddd",
        userId,
        clientId: { _id: clientId, customerName: "Client" },
        projectId: { _id: projectId, name: "Archived Project", isActive: false },
        workDate: new Date("2026-11-08T17:00:00.000Z"),
        hours: 5,
      },
    ],
  });
  TimesheetSubmission.find = () => ({
    sort() { return this; },
    lean: async () => [],
  });

  const res = createResponse();
  try {
    await getOverview(
      {
        query: { from: "2026-11-09", to: "2026-11-15" },
        user: { _id: userId },
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.data.summary.totalHours, 0);
    assert.deepEqual(res.data.summary.clients, []);
    assert.deepEqual(res.data.entries, []);
  } finally {
    periodCanEdit = false;
    TimesheetEntry.aggregate = originalAggregate;
    TimesheetEntry.find = originalEntryFind;
    TimesheetSubmission.find = originalSubmissionFind;
  }
});
