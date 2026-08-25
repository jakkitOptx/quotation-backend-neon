const User = require("../models/User");
const ApproveFlow = require("../models/ApproveFlow");

const DASHBOARD_USER_SELECT =
  "username department team teamGroup role flow";

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const canUserApproveTimesheets = async (viewer) => {
  const username = normalizeEmail(viewer?.username);
  if (!username) {
    return false;
  }

  return Boolean(
    await ApproveFlow.exists({
      "approvalHierarchy.approver": {
        $regex: `^${escapeRegex(username)}$`,
        $options: "i",
      },
    })
  );
};

const getViewerDashboardScope = async (viewer) => {
  if (!viewer?._id) {
    return {
      canViewDashboard: false,
      scope: "self",
      visibleUserIds: [],
    };
  }

  if (viewer.role === "admin") {
    const users = await User.find({}, "_id").lean();
    return {
      canViewDashboard: true,
      scope: "all",
      visibleUserIds: [...new Set(users.map((user) => String(user._id)))],
    };
  }

  const normalizedUsername = normalizeEmail(viewer.username);
  if (!normalizedUsername) {
    return {
      canViewDashboard: false,
      scope: "self",
      visibleUserIds: [],
    };
  }

  const flows = await ApproveFlow.find(
    {
      "approvalHierarchy.approver": {
        $regex: `^${escapeRegex(normalizedUsername)}$`,
        $options: "i",
      },
    },
    "_id"
  ).lean();

  if (flows.length === 0) {
    return {
      canViewDashboard: false,
      scope: "self",
      visibleUserIds: [],
    };
  }

  const flowIds = flows.map((flow) => flow._id);
  const visibleUsers = await User.find(
    { flow: { $in: flowIds } },
    "_id"
  ).lean();

  return {
    canViewDashboard: visibleUsers.length > 0,
    scope: visibleUsers.length > 0 ? "approver" : "self",
    visibleUserIds: [...new Set(visibleUsers.map((user) => String(user._id)))],
  };
};

const canViewTimesheet = async (viewer, targetUser) => {
  if (!viewer?._id || !targetUser?._id) {
    return false;
  }

  if (String(viewer._id) === String(targetUser._id)) {
    return true;
  }

  if (viewer.role === "admin") {
    return true;
  }

  if (!targetUser.flow || !viewer.username) {
    return false;
  }

  const flow = await ApproveFlow.findById(targetUser.flow, "approvalHierarchy").lean();
  if (!flow) {
    return false;
  }

  const normalizedViewerUsername = normalizeEmail(viewer.username);

  return (flow.approvalHierarchy || []).some(
    (step) => normalizeEmail(step.approver) === normalizedViewerUsername
  );
};

const getVisibleDashboardUsers = async (viewer) => {
  const scope = await getViewerDashboardScope(viewer);

  if (viewer?.role === "admin") {
    const users = await User.find(
      {},
      "_id username department team teamGroup"
    )
      .sort({ username: 1 })
      .lean();

    return {
      canViewDashboard: true,
      scope: "all",
      data: users,
      visibleUserIds: scope.visibleUserIds,
    };
  }

  if (!scope.canViewDashboard || scope.visibleUserIds.length === 0) {
    return {
      canViewDashboard: false,
      scope: "self",
      data: [],
      visibleUserIds: [],
    };
  }

  const users = await User.find(
    { _id: { $in: scope.visibleUserIds } },
    "_id username department team teamGroup"
  )
    .sort({ username: 1 })
    .lean();

  return {
    canViewDashboard: true,
    scope: "approver",
    data: users,
    visibleUserIds: users.map((user) => String(user._id)),
  };
};

module.exports = {
  DASHBOARD_USER_SELECT,
  canUserApproveTimesheets,
  getViewerDashboardScope,
  canViewTimesheet,
  getVisibleDashboardUsers,
};
