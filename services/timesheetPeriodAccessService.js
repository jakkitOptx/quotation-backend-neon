const TimesheetSubmission = require("../models/TimesheetSubmission");
const TimesheetPeriodOverride = require("../models/TimesheetPeriodOverride");
const {
  ACTIVE_SUBMISSION_STATUSES,
} = require("./timesheetLockService");
const {
  formatWorkDate,
  getDeadlineDateKey,
  getThailandDateKey,
  getWeeklyPeriod,
  getWeeklyPeriodForWorkDate,
  parseWorkDate,
} = require("../utils/timesheet");

const getPeriod = ({ periodStart, workDate }) => {
  if (periodStart !== undefined) {
    return getWeeklyPeriod(periodStart);
  }

  if (workDate === undefined) {
    return null;
  }

  const parsedWorkDate = workDate instanceof Date ? workDate : parseWorkDate(workDate);
  return parsedWorkDate ? getWeeklyPeriodForWorkDate(parsedWorkDate) : null;
};

const getTimesheetPeriodAccess = async ({ userId, periodStart, workDate, now }) => {
  const period = getPeriod({ periodStart, workDate });
  if (!period) {
    return null;
  }

  const today = getThailandDateKey(now || new Date());
  const deadline = getDeadlineDateKey(period.periodEnd);
  const todayDate = parseWorkDate(today);

  const [submission, override] = await Promise.all([
    TimesheetSubmission.findOne({
      userId,
      status: { $in: ACTIVE_SUBMISSION_STATUSES },
      periodStart: { $lte: period.periodEnd },
      periodEnd: { $gte: period.periodStart },
    })
      .select("status")
      .lean(),
    TimesheetPeriodOverride.findOne({
      userId,
      periodType: "week",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      isActive: true,
      reopenUntil: { $gte: todayDate },
    })
      .sort({ reopenedAt: -1 })
      .populate("reopenedBy", "username")
      .lean(),
  ]);

  const submissionStatus = submission?.status || null;
  const isApprovalLocked = Boolean(submissionStatus);
  const isExpired = today > deadline;
  const isReopened = Boolean(override);
  const canMutate = !isApprovalLocked && (!isExpired || isReopened);
  const lockReason = isApprovalLocked ? submissionStatus : isExpired && !isReopened ? "deadline" : null;

  return {
    periodStart: period.periodStartKey,
    periodEnd: period.periodEndKey,
    deadline,
    submissionStatus,
    isApprovalLocked,
    isExpired,
    isReopened,
    reopenUntil: override ? formatWorkDate(override.reopenUntil) : null,
    override,
    canEdit: canMutate,
    canSubmit: canMutate,
    lockReason,
  };
};

module.exports = {
  getTimesheetPeriodAccess,
};
