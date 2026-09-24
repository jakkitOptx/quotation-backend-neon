const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getWeeklyPeriod } = require("../utils/timesheet");

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
        deadline: period.periodEndKey,
        isExpired: false,
        isReopened: false,
        reopenUntil: null,
        submissionStatus: null,
        canEdit: true,
        canSubmit: true,
        lockReason: null,
      };
    },
  },
};

const TimesheetEntry = require("../models/TimesheetEntry");
const TimesheetSubmission = require("../models/TimesheetSubmission");
const { getOverview } = require("../controllers/timesheetController");

const emptyEntryQuery = () => ({
  sort() {
    return this;
  },
  populate() {
    return this;
  },
  lean: async () => [],
});

const emptySubmissionQuery = () => ({
  sort() {
    return this;
  },
  lean: async () => [],
});

test("overview supports weekly and monthly ranges", async () => {
  const originalAggregate = TimesheetEntry.aggregate;
  const originalEntryFind = TimesheetEntry.find;
  const originalSubmissionFind = TimesheetSubmission.find;

  TimesheetEntry.aggregate = async () => [];
  TimesheetEntry.find = emptyEntryQuery;
  TimesheetSubmission.find = emptySubmissionQuery;

  const req = {
    query: { from: "2026-09-01", to: "2026-09-30" },
    user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
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
    await getOverview(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.data.range, { from: "2026-09-01", to: "2026-09-30" });
    assert.equal(res.data.summary.totalHours, 0);
    assert.deepEqual(res.data.entries, []);
    assert.deepEqual(res.data.submissions, []);
    assert.equal(res.data.periodStatuses.length, 5);
    assert.equal(res.data.periodStatuses[0].periodStart, "2026-08-31");
    assert.equal(res.data.periodStatuses[4].periodStart, "2026-09-28");

    req.query = { from: "2026-09-21", to: "2026-09-27" };
    await getOverview(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.periodStatuses.length, 1);
    assert.equal(res.data.periodStatuses[0].periodStart, "2026-09-21");
    assert.equal(res.data.periodStatuses[0].periodEnd, "2026-09-27");
  } finally {
    TimesheetEntry.aggregate = originalAggregate;
    TimesheetEntry.find = originalEntryFind;
    TimesheetSubmission.find = originalSubmissionFind;
  }
});
