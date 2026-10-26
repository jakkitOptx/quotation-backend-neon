const Notification = require("../models/Notification");
const User = require("../models/User");
const { formatWorkDate } = require("../utils/timesheet");
const { sendSocketNotification } = require("./socketNotificationService");

const TIMESHEET_MODULE = "timesheet";

const TIMESHEET_NOTIFICATION_EVENTS = Object.freeze({
  pending: "submission_pending",
  approved: "submission_approved",
  fullyApproved: "submission_fully_approved",
  rejected: "submission_rejected",
});

const normalizeRecipient = (value) => String(value || "").trim().toLowerCase();

const formatDisplayName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
  user?.username ||
  "";

const formatPeriod = (submission) =>
  `${formatWorkDate(submission.periodStart)} - ${formatWorkDate(submission.periodEnd)}`;

const buildApprovalLink = (submissionId) => `/timesheets/approvals/${submissionId}`;

const findSubmitter = (submission) =>
  User.findById(submission.userId, "username firstName lastName").lean();

const createNotifications = async (items) => {
  const notifications = items
    .map((item) => ({ ...item, user: normalizeRecipient(item.user) }))
    .filter((item) => item.user);
  if (notifications.length === 0) {
    return [];
  }

  const now = new Date();
  const created = await Notification.insertMany(
    notifications.map((item) => ({
      user: item.user,
      title: item.title,
      message: item.message,
      link: buildApprovalLink(item.entityId),
      type: "approval",
      module: TIMESHEET_MODULE,
      event: item.event,
      entityId: item.entityId,
      createdBy: normalizeRecipient(item.createdBy) || "system",
      createdAt: now,
    }))
  );

  await Promise.all(
    notifications.map((item) =>
      sendSocketNotification(item.user, item.title, item.message)
    )
  );

  return created;
};

// Notification failures are logged and must not fail a completed Timesheet action.
const runSafely = async (label, task) => {
  try {
    return await task();
  } catch (error) {
    console.error(`Timesheet notification error (${label}):`, error);
    return null;
  }
};

const getPendingStep = (submission) =>
  (submission.approvalSteps || []).find(
    (step) =>
      step.status === "pending" &&
      Number(step.level) === Number(submission.currentApprovalLevel)
  ) || null;

const buildPendingNotification = ({ submission, submitter, actor }) => {
  const step = getPendingStep(submission);
  if (!step) {
    return null;
  }

  return {
    user: step.approverUsername,
    title: "📩 Timesheet รออนุมัติ",
    message: `Timesheet ของ ${formatDisplayName(submitter)} (${formatPeriod(submission)}, ${submission.totalHours} ชม.) รอการอนุมัติจากคุณ`,
    event: TIMESHEET_NOTIFICATION_EVENTS.pending,
    entityId: submission._id,
    createdBy: actor,
  };
};

// The approver who just acted no longer needs the "waiting for you" item.
const markActionRequiredAsRead = (submissionId, approverUsername) =>
  Notification.updateMany(
    {
      module: TIMESHEET_MODULE,
      entityId: submissionId,
      event: TIMESHEET_NOTIFICATION_EVENTS.pending,
      user: normalizeRecipient(approverUsername),
      isRead: false,
    },
    { $set: { isRead: true, readAt: new Date() } }
  );

const notifySubmissionCreated = ({ submission, submitter }) =>
  runSafely("submitted", async () => {
    const pending = buildPendingNotification({
      submission,
      submitter,
      actor: submitter?.username,
    });
    return pending ? createNotifications([pending]) : [];
  });

const notifySubmissionApproved = ({ submission, approver, level }) =>
  runSafely("approved", async () => {
    await markActionRequiredAsRead(submission._id, approver.username);

    const submitter = await findSubmitter(submission);
    const isFinal = submission.status === "approved";
    const items = [
      {
        user: submitter?.username,
        title: isFinal
          ? "✅ Timesheet อนุมัติครบทุกลำดับแล้ว"
          : "✅ Timesheet ได้รับการอนุมัติ",
        message: isFinal
          ? `Timesheet ${formatPeriod(submission)} ได้รับการอนุมัติครบทุกลำดับแล้ว`
          : `Timesheet ${formatPeriod(submission)} ได้รับการอนุมัติลำดับที่ ${level} จาก ${formatDisplayName(approver)}`,
        event: isFinal
          ? TIMESHEET_NOTIFICATION_EVENTS.fullyApproved
          : TIMESHEET_NOTIFICATION_EVENTS.approved,
        entityId: submission._id,
        createdBy: approver.username,
      },
    ];

    if (!isFinal) {
      const pending = buildPendingNotification({
        submission,
        submitter,
        actor: approver.username,
      });
      if (pending) {
        items.push(pending);
      }
    }

    return createNotifications(items);
  });

const notifySubmissionRejected = ({ submission, approver, reason }) =>
  runSafely("rejected", async () => {
    await markActionRequiredAsRead(submission._id, approver.username);

    const submitter = await findSubmitter(submission);
    return createNotifications([
      {
        user: submitter?.username,
        title: "🚫 Timesheet ถูก Reject",
        message: `Timesheet ${formatPeriod(submission)} ถูก Reject โดย ${formatDisplayName(approver)}: ${reason}`,
        event: TIMESHEET_NOTIFICATION_EVENTS.rejected,
        entityId: submission._id,
        createdBy: approver.username,
      },
    ]);
  });

// A withdrawn submission removes every notification it produced, read or not.
const removeSubmissionNotifications = (submissionId) =>
  runSafely("withdrawn", () =>
    Notification.deleteMany({ module: TIMESHEET_MODULE, entityId: submissionId })
  );

module.exports = {
  TIMESHEET_MODULE,
  TIMESHEET_NOTIFICATION_EVENTS,
  notifySubmissionCreated,
  notifySubmissionApproved,
  notifySubmissionRejected,
  removeSubmissionNotifications,
};
