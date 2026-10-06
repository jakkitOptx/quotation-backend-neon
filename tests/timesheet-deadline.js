const { test } = require("node:test");
const assert = require("node:assert/strict");

const TimesheetSubmission = require("../models/TimesheetSubmission");
const TimesheetPeriodOverride = require("../models/TimesheetPeriodOverride");
const {
  getDeadlineDateKey,
  parseWorkDate,
} = require("../utils/timesheet");
const {
  getTimesheetPeriodAccess,
} = require("../services/timesheetPeriodAccessService");

test("Timesheet deadline is one calendar month after the period end", () => {
  assert.equal(getDeadlineDateKey(parseWorkDate("2026-09-27")), "2026-10-27");
  assert.equal(getDeadlineDateKey(parseWorkDate("2027-01-31")), "2027-02-28");
  assert.equal(getDeadlineDateKey(parseWorkDate("2028-01-31")), "2028-02-29");
  assert.equal(getDeadlineDateKey(parseWorkDate("2026-12-31")), "2027-01-31");
});

test("Timesheet can be edited through the one-month deadline but not after it", async () => {
  const originalSubmissionFindOne = TimesheetSubmission.findOne;
  const originalOverrideFindOne = TimesheetPeriodOverride.findOne;

  TimesheetSubmission.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => null,
  });
  TimesheetPeriodOverride.findOne = () => ({
    sort() {
      return this;
    },
    populate() {
      return this;
    },
    lean: async () => null,
  });

  try {
    const onDeadline = await getTimesheetPeriodAccess({
      userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      periodStart: "2026-09-21",
      now: new Date("2026-10-27T05:00:00.000Z"),
    });
    assert.equal(onDeadline.deadline, "2026-10-27");
    assert.equal(onDeadline.isExpired, false);
    assert.equal(onDeadline.canEdit, true);

    const afterDeadline = await getTimesheetPeriodAccess({
      userId: "aaaaaaaaaaaaaaaaaaaaaaaa",
      periodStart: "2026-09-21",
      now: new Date("2026-10-27T17:00:00.000Z"),
    });
    assert.equal(afterDeadline.isExpired, true);
    assert.equal(afterDeadline.canEdit, false);
    assert.equal(afterDeadline.canSubmit, false);
    assert.equal(afterDeadline.lockReason, "deadline");
  } finally {
    TimesheetSubmission.findOne = originalSubmissionFindOne;
    TimesheetPeriodOverride.findOne = originalOverrideFindOne;
  }
});
