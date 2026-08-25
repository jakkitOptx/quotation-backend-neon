const TimesheetSubmission = require("../models/TimesheetSubmission");

const ACTIVE_SUBMISSION_STATUSES = ["pending", "approved"];

const isTimesheetDateLocked = async (userId, workDate) => {
  const lockedSubmission = await TimesheetSubmission.exists({
    userId,
    status: { $in: ACTIVE_SUBMISSION_STATUSES },
    periodStart: { $lte: workDate },
    periodEnd: { $gte: workDate },
  });

  return Boolean(lockedSubmission);
};

const areTimesheetDatesLocked = async (userId, workDates) => {
  const uniqueDates = [...new Map((workDates || []).filter(Boolean).map((date) => [date.getTime(), date])).values()];

  for (const workDate of uniqueDates) {
    if (await isTimesheetDateLocked(userId, workDate)) {
      return true;
    }
  }

  return false;
};

module.exports = {
  ACTIVE_SUBMISSION_STATUSES,
  isTimesheetDateLocked,
  areTimesheetDatesLocked,
};
