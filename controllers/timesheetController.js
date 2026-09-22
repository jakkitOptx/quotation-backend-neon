const mongoose = require("mongoose");
const Client = require("../models/Client");
const User = require("../models/User");
const TimesheetProject = require("../models/TimesheetProject");
const TimesheetDetail = require("../models/TimesheetDetail");
const TimesheetEntry = require("../models/TimesheetEntry");
const TimesheetSubmission = require("../models/TimesheetSubmission");
const TimesheetPeriodOverride = require("../models/TimesheetPeriodOverride");
const ApproveFlow = require("../models/ApproveFlow");
const {
  canUserApproveTimesheets,
  canViewTimesheet,
  getViewerDashboardScope,
  getVisibleDashboardUsers,
} = require("../services/timesheetPermissionService");
const {
  normalizeScopedName,
  normalizeOptionalRemark,
  parseDateRange,
  parseWorkDate,
  getWeeklyPeriod,
  formatWorkDate,
  getThailandDateKey,
} = require("../utils/timesheet");
const {
  ACTIVE_SUBMISSION_STATUSES,
} = require("../services/timesheetLockService");
const {
  getTimesheetPeriodAccess,
} = require("../services/timesheetPeriodAccessService");
const { logTimesheetActivity } = require("../services/timesheetAuditService");

const CLIENT_SELECT_FIELDS =
  "customerName companyBaseName email authorizedApprovers address taxIdentificationNumber contactPhoneNumber branchNo";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isDuplicateKeyError = (error) => error?.code === 11000;

const trimName = (value) => String(value || "").trim().replace(/\s+/g, " ");

const parseHours = (value) => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeEntryOutput = (entry) => ({
  ...entry,
  workDate: formatWorkDate(entry.workDate),
});

const buildProjectResponse = (project) => ({
  ...project,
  clientId: project.clientId,
  remark: project.remark || "",
});

const buildDetailResponse = (detail) => ({
  ...detail,
  projectId: detail.projectId,
});

const TIMESHEET_ENTRY_DUPLICATE_MESSAGE =
  "A timesheet entry already exists for this project and date";
const TIMESHEET_PERIOD_LOCKED_MESSAGE = "This timesheet period is locked";
const TIMESHEET_PERIOD_DEADLINE_MESSAGE =
  "This timesheet period is past the submission deadline";
const SUBMISSION_STATUSES = ["pending", "approved", "rejected", "withdrawn"];
// Three consecutive calendar months contain at most 92 days.
const MAX_DASHBOARD_EXPORT_DAYS = 92;

const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
const escapeRegex = (value) => String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const formatUserDisplayName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
  user?.username ||
  "";

const respondPeriodAccessBlock = (res, access) =>
  res.status(409).json({
    message:
      access.lockReason === "deadline"
        ? TIMESHEET_PERIOD_DEADLINE_MESSAGE
        : TIMESHEET_PERIOD_LOCKED_MESSAGE,
  });

const isAdmin = (user) => user?.role === "admin";

const buildSubmissionResponse = (submission) => ({
  ...submission,
  periodStart: formatWorkDate(submission.periodStart),
  periodEnd: formatWorkDate(submission.periodEnd),
});

const buildApprovalStepsSnapshot = async (user) => {
  if (!user.flow) {
    return null;
  }

  const flow = await ApproveFlow.findById(user.flow, "approvalHierarchy").lean();
  const hierarchy = (flow?.approvalHierarchy || [])
    .map((step) => ({
      level: Number(step.level),
      approverUsername: String(step.approver || "").trim(),
    }))
    .filter((step) => Number.isFinite(step.level) && step.approverUsername)
    .sort(
      (left, right) =>
        left.level - right.level ||
        left.approverUsername.localeCompare(right.approverUsername)
    );

  if (hierarchy.length === 0) {
    return null;
  }

  const approverUsernames = [...new Set(hierarchy.map((step) => normalizeUsername(step.approverUsername)))];
  const approvers = await User.find(
    { username: { $in: approverUsernames } },
    "_id username"
  ).lean();
  const approverIdsByUsername = new Map(
    approvers.map((approver) => [normalizeUsername(approver.username), approver._id])
  );

  return hierarchy.map((step, index) => ({
    level: step.level,
    approverUsername: step.approverUsername,
    approverUserId: approverIdsByUsername.get(
      normalizeUsername(step.approverUsername)
    ) || null,
    status: index === 0 ? "pending" : "waiting",
  }));
};

const matchesApprovalStep = (step, viewer) => {
  if (!step || !viewer?._id) {
    return false;
  }

  if (step.approverUserId) {
    return String(step.approverUserId) === String(viewer._id);
  }

  return (
    normalizeUsername(step.approverUsername) === normalizeUsername(viewer.username)
  );
};

const getCurrentApprovalStep = (submission) => {
  if (submission?.status !== "pending" || submission.currentApprovalLevel == null) {
    return null;
  }

  const index = (submission.approvalSteps || []).findIndex(
    (step) =>
      step.status === "pending" &&
      Number(step.level) === Number(submission.currentApprovalLevel)
  );

  return index === -1 ? null : { index, step: submission.approvalSteps[index] };
};

const buildApprovalActionFilter = ({ submission, current, viewer }) => {
  const currentPath = `approvalSteps.${current.index}`;
  const filter = {
    _id: submission._id,
    status: "pending",
    currentApprovalLevel: current.step.level,
    [`${currentPath}.status`]: "pending",
  };

  if (current.step.approverUserId) {
    filter[`${currentPath}.approverUserId`] = viewer._id;
  } else {
    filter[`${currentPath}.approverUsername`] = new RegExp(
      `^${escapeRegex(viewer.username)}$`,
      "i"
    );
  }

  return filter;
};

const buildDailyKeys = (range) => {
  const dailyKeys = [];

  for (
    let current = new Date(range.start.getTime());
    current < range.endExclusive;
    current = new Date(current.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dailyKeys.push(formatWorkDate(current));
  }

  return dailyKeys;
};

const aggregateHierarchicalSummary = async ({
  userIds,
  range,
  clientId,
  projectId,
  includeInactiveProjects = false,
}) => {
  const match = {
    userId: { $in: userIds },
    workDate: {
      $gte: range.start,
      $lt: range.endExclusive,
    },
  };

  if (clientId) {
    match.clientId = clientId;
  }

  if (projectId) {
    match.projectId = projectId;
  }

  const summary = await TimesheetEntry.aggregate([
    { $match: match },
    {
      $lookup: {
        from: "users",
        localField: "userId",
        foreignField: "_id",
        as: "user",
      },
    },
    {
      $lookup: {
        from: "clients",
        localField: "clientId",
        foreignField: "_id",
        as: "client",
      },
    },
    {
      $lookup: {
        from: "timesheetprojects",
        localField: "projectId",
        foreignField: "_id",
        as: "project",
      },
    },
    { $unwind: "$user" },
    { $unwind: "$client" },
    { $unwind: "$project" },
    ...(includeInactiveProjects
      ? []
      : [{ $match: { "project.isActive": true } }]),
    {
      $group: {
        _id: {
          userId: "$userId",
          clientId: "$clientId",
          projectId: "$projectId",
          workDate: "$workDate",
        },
        firstName: { $first: "$user.firstName" },
        lastName: { $first: "$user.lastName" },
        username: { $first: "$user.username" },
        department: { $first: "$user.department" },
        clientName: { $first: "$client.customerName" },
        projectName: { $first: "$project.name" },
        projectRemark: { $first: "$project.remark" },
        dayHours: { $sum: "$hours" },
      },
    },
    {
      $sort: {
        username: 1,
        clientName: 1,
        projectName: 1,
        "_id.workDate": 1,
      },
    },
  ]);

  const dailyKeys = buildDailyKeys(range);

  const usersMap = new Map();
  let totalHours = 0;

  summary.forEach((item) => {
    totalHours += item.dayHours;

    const userKey = String(item._id.userId);
    const clientKey = String(item._id.clientId);
    const projectKey = String(item._id.projectId);
    const workDateKey = formatWorkDate(item._id.workDate);

    if (!usersMap.has(userKey)) {
      usersMap.set(userKey, {
        userId: item._id.userId,
        username: formatUserDisplayName(item),
        department: item.department || "",
        totalHours: 0,
        clients: [],
        clientMap: new Map(),
      });
    }

    const userNode = usersMap.get(userKey);
    userNode.totalHours += item.dayHours;

    if (!userNode.clientMap.has(clientKey)) {
      userNode.clientMap.set(clientKey, {
        clientId: item._id.clientId,
        clientName: item.clientName,
        totalHours: 0,
        projects: [],
        projectMap: new Map(),
      });
      userNode.clients.push(userNode.clientMap.get(clientKey));
    }

    const clientNode = userNode.clientMap.get(clientKey);
    clientNode.totalHours += item.dayHours;

    if (!clientNode.projectMap.has(projectKey)) {
      const dailyHours = {};
      dailyKeys.forEach((key) => {
        dailyHours[key] = 0;
      });

      clientNode.projectMap.set(projectKey, {
        projectId: item._id.projectId,
        name: item.projectName,
        remark: item.projectRemark || "",
        dailyHours,
        totalHours: 0,
      });
      clientNode.projects.push(clientNode.projectMap.get(projectKey));
    }

    const projectNode = clientNode.projectMap.get(projectKey);
    projectNode.dailyHours[workDateKey] = Number(
      (projectNode.dailyHours[workDateKey] + item.dayHours).toFixed(2)
    );
    projectNode.totalHours += item.dayHours;
  });

  const users = Array.from(usersMap.values()).map((user) => ({
    userId: user.userId,
    username: user.username,
    department: user.department,
    totalHours: Number(user.totalHours.toFixed(2)),
    clients: user.clients.map((client) => ({
      clientId: client.clientId,
      clientName: client.clientName,
      totalHours: Number(client.totalHours.toFixed(2)),
      projects: client.projects.map((project) => ({
        projectId: project.projectId,
        name: project.name,
        remark: project.remark || "",
        dailyHours: project.dailyHours,
        totalHours: Number(project.totalHours.toFixed(2)),
      })),
    })),
  }));

  return {
    totalHours: Number(totalHours.toFixed(2)),
    users,
  };
};

const getTimesheetSummaryForUser = async (userId, range) => {
  const aggregated = await aggregateHierarchicalSummary({
    userIds: [userId],
    range,
  });
  const userSummary = aggregated.users[0];

  return {
    range: { from: range.from, to: range.to },
    totalHours: aggregated.totalHours,
    clients: userSummary?.clients || [],
  };
};

const ensureClientExists = async (clientId) => {
  const client = await Client.findById(clientId).select("_id").lean();
  if (!client) {
    return { status: 400, message: "Client not found" };
  }

  return null;
};

const findActiveProjectByName = ({ userId, clientId, normalizedName }) =>
  TimesheetProject.findOne({
    userId,
    clientId,
    normalizedName,
    isActive: true,
  }).lean();

const reactivateArchivedProjectByName = ({
  userId,
  clientId,
  normalizedName,
  name,
  remark,
}) =>
  TimesheetProject.findOneAndUpdate(
    {
      userId,
      clientId,
      normalizedName,
      isActive: false,
    },
    {
      $set: {
        name,
        remark,
        isActive: true,
      },
    },
    { new: true }
  ).lean();

const respondWithReusableProject = (res, project) =>
  res.status(200).json({
    message: "Project ready to use",
    reused: true,
    data: buildProjectResponse(project),
  });

const validateHierarchy = async ({ userId, clientId, projectId }) => {
  const [client, project] = await Promise.all([
    Client.findById(clientId).select("_id").lean(),
    TimesheetProject.findOne({ _id: projectId, userId })
      .select("_id clientId isActive")
      .lean(),
  ]);

  if (!client) {
    return { status: 400, message: "Client not found" };
  }

  if (!project) {
    return { status: 400, message: "Selected project was not found" };
  }

  if (String(project.clientId) !== String(clientId)) {
    return { status: 400, message: "Project does not belong to the selected client" };
  }

  if (!project.isActive) {
    return { status: 400, message: "Selected project is archived" };
  }

  return null;
};

const findEntryCollision = async ({
  userId,
  projectId,
  workDate,
  excludeEntryId = null,
}) => {
  const query = {
    userId,
    projectId,
    workDate,
  };

  if (excludeEntryId) {
    query._id = { $ne: excludeEntryId };
  }

  return TimesheetEntry.findOne(query).select("_id").lean();
};

exports.getProjects = async (req, res) => {
  try {
    const { clientId } = req.query;
    const query = { userId: req.user._id, isActive: true };

    if (clientId !== undefined) {
      if (!isValidObjectId(clientId)) {
        return res.status(400).json({ message: "Invalid clientId" });
      }

      query.clientId = clientId;
    }

    const projects = await TimesheetProject.find(query).sort({ name: 1 }).lean();

    return res.status(200).json({
      data: projects.map(buildProjectResponse),
    });
  } catch (error) {
    console.error("getProjects error:", error);
    return res.status(500).json({ message: "Failed to fetch projects" });
  }
};

exports.createProject = async (req, res) => {
  try {
    const { clientId, name } = req.body;
    const trimmedName = trimName(name);
    const remark = normalizeOptionalRemark(req.body.remark);

    if (!isValidObjectId(clientId)) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: "Project name is required" });
    }

    if (remark === null) {
      return res.status(400).json({ message: "Remark must be a string" });
    }

    const clientError = await ensureClientExists(clientId);
    if (clientError) {
      return res.status(clientError.status).json({ message: clientError.message });
    }

    const normalizedName = normalizeScopedName(trimmedName);
    const duplicate = await findActiveProjectByName({
      userId: req.user._id,
      clientId,
      normalizedName,
    });

    if (duplicate) {
      return respondWithReusableProject(res, duplicate);
    }

    const reactivatedProject = await reactivateArchivedProjectByName({
      userId: req.user._id,
      clientId,
      normalizedName,
      name: trimmedName,
      remark,
    });

    if (reactivatedProject) {
      await logTimesheetActivity({
        actor: req.user.username,
        action: "project_reactivated",
        description: `Reactivated Timesheet project "${reactivatedProject.name}"`,
        entityId: reactivatedProject._id,
        metadata: {
          clientId: String(reactivatedProject.clientId),
          remark: reactivatedProject.remark,
        },
      });

      return res.status(200).json({
        message: "Project reactivated successfully",
        reused: true,
        reactivated: true,
        data: buildProjectResponse(reactivatedProject),
      });
    }

    const project = await TimesheetProject.create({
      userId: req.user._id,
      clientId,
      name: trimmedName,
      normalizedName,
      remark,
    });

    await logTimesheetActivity({
      actor: req.user.username,
      action: "project_created",
      description: `Created Timesheet project "${project.name}"`,
      entityId: project._id,
      metadata: { clientId: String(project.clientId), remark: project.remark },
    });

    return res.status(201).json({
      message: "Project created successfully",
      reused: false,
      data: project.toObject(),
    });
  } catch (error) {
    console.error("createProject error:", error);
    if (isDuplicateKeyError(error)) {
      try {
        const clientId = req.body?.clientId;
        const normalizedName = normalizeScopedName(trimName(req.body?.name));
        const existingProject = await findActiveProjectByName({
          userId: req.user._id,
          clientId,
          normalizedName,
        });

        if (existingProject) {
          return respondWithReusableProject(res, existingProject);
        }
      } catch (lookupError) {
        console.error("createProject duplicate lookup error:", lookupError);
      }

      return res
        .status(409)
        .json({ message: "A project with this name already exists for this client" });
    }

    return res.status(500).json({ message: "Failed to create project" });
  }
};

exports.updateProject = async (req, res) => {
  try {
    const { id } = req.params;
    const hasName = Object.prototype.hasOwnProperty.call(req.body, "name");
    const hasRemark = Object.prototype.hasOwnProperty.call(req.body, "remark");
    const trimmedName = hasName ? trimName(req.body.name) : null;
    const remark = hasRemark ? normalizeOptionalRemark(req.body.remark) : undefined;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    if (!hasName && !hasRemark) {
      return res.status(400).json({ message: "Name or remark is required" });
    }

    if (hasName && !trimmedName) {
      return res.status(400).json({ message: "Project name is required" });
    }

    if (hasRemark && remark === null) {
      return res.status(400).json({ message: "Remark must be a string" });
    }

    const project = await TimesheetProject.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const normalizedName = hasName
      ? normalizeScopedName(trimmedName)
      : project.normalizedName;
    const duplicate = hasName
      ? await TimesheetProject.findOne({
          _id: { $ne: project._id },
          userId: req.user._id,
          clientId: project.clientId,
          normalizedName,
          isActive: true,
        }).lean()
      : null;

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A project with this name already exists for this client" });
    }

    const previousName = project.name;
    const previousRemark = project.remark || "";
    if (hasName) {
      project.name = trimmedName;
      project.normalizedName = normalizedName;
    }
    if (hasRemark) {
      project.remark = remark;
    }
    await project.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: hasName ? "project_renamed" : "project_remark_updated",
      description: hasName
        ? `Renamed Timesheet project from "${previousName}" to "${project.name}"`
        : `Updated remark for Timesheet project "${project.name}"`,
      entityId: project._id,
      metadata: {
        previousName,
        name: project.name,
        previousRemark,
        remark: project.remark || "",
        clientId: String(project.clientId),
      },
    });

    return res.status(200).json({
      message: "Project updated successfully",
      data: project.toObject(),
    });
  } catch (error) {
    console.error("updateProject error:", error);
    if (isDuplicateKeyError(error)) {
      return res
        .status(409)
        .json({ message: "A project with this name already exists for this client" });
    }

    return res.status(500).json({ message: "Failed to update project" });
  }
};

exports.deleteProject = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const project = await TimesheetProject.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    project.isActive = false;
    await project.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "project_archived",
      description: `Archived Timesheet project "${project.name}"`,
      entityId: project._id,
      metadata: { clientId: String(project.clientId) },
    });

    return res.status(200).json({
      message: "Project archived successfully",
      data: project.toObject(),
    });
  } catch (error) {
    console.error("deleteProject error:", error);
    return res.status(500).json({ message: "Failed to archive project" });
  }
};

exports.getDetails = async (req, res) => {
  try {
    const { projectId } = req.params;

    if (!isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    const project = await TimesheetProject.findOne({
      _id: projectId,
      userId: req.user._id,
    })
      .select("_id isActive")
      .lean();

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const details = await TimesheetDetail.find({
      projectId,
      userId: req.user._id,
      isActive: true,
    })
      .sort({ name: 1 })
      .lean();

    return res.status(200).json({
      data: details.map(buildDetailResponse),
    });
  } catch (error) {
    console.error("getDetails error:", error);
    return res.status(500).json({ message: "Failed to fetch details" });
  }
};

exports.createDetail = async (req, res) => {
  try {
    const { projectId } = req.params;
    const trimmedName = trimName(req.body.name);

    if (!isValidObjectId(projectId)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: "Detail name is required" });
    }

    const project = await TimesheetProject.findOne({
      _id: projectId,
      userId: req.user._id,
    })
      .select("_id isActive")
      .lean();

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    if (!project.isActive) {
      return res.status(409).json({ message: "Cannot add details to an archived project" });
    }

    const normalizedName = normalizeScopedName(trimmedName);
    const duplicate = await TimesheetDetail.findOne({
      userId: req.user._id,
      projectId,
      normalizedName,
      isActive: true,
    }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A detail with this name already exists for this project" });
    }

    const detail = await TimesheetDetail.create({
      userId: req.user._id,
      projectId,
      name: trimmedName,
      normalizedName,
    });

    await logTimesheetActivity({
      actor: req.user.username,
      action: "detail_created",
      description: `Created Timesheet detail "${detail.name}"`,
      entityId: detail._id,
      metadata: { projectId: String(detail.projectId) },
    });

    return res.status(201).json({
      message: "Detail created successfully",
      data: detail.toObject(),
    });
  } catch (error) {
    console.error("createDetail error:", error);
    if (isDuplicateKeyError(error)) {
      return res
        .status(409)
        .json({ message: "A detail with this name already exists for this project" });
    }

    return res.status(500).json({ message: "Failed to create detail" });
  }
};

exports.updateDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const trimmedName = trimName(req.body.name);

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid detail id" });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: "Detail name is required" });
    }

    const detail = await TimesheetDetail.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!detail) {
      return res.status(404).json({ message: "Detail not found" });
    }

    const normalizedName = normalizeScopedName(trimmedName);
    const duplicate = await TimesheetDetail.findOne({
      _id: { $ne: detail._id },
      userId: req.user._id,
      projectId: detail.projectId,
      normalizedName,
      isActive: true,
    }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A detail with this name already exists for this project" });
    }

    const previousName = detail.name;
    detail.name = trimmedName;
    detail.normalizedName = normalizedName;
    await detail.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "detail_renamed",
      description: `Renamed Timesheet detail from "${previousName}" to "${detail.name}"`,
      entityId: detail._id,
      metadata: { previousName, name: detail.name, projectId: String(detail.projectId) },
    });

    return res.status(200).json({
      message: "Detail updated successfully",
      data: detail.toObject(),
    });
  } catch (error) {
    console.error("updateDetail error:", error);
    if (isDuplicateKeyError(error)) {
      return res
        .status(409)
        .json({ message: "A detail with this name already exists for this project" });
    }

    return res.status(500).json({ message: "Failed to update detail" });
  }
};

exports.deleteDetail = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid detail id" });
    }

    const detail = await TimesheetDetail.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!detail) {
      return res.status(404).json({ message: "Detail not found" });
    }

    detail.isActive = false;
    await detail.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "detail_archived",
      description: `Archived Timesheet detail "${detail.name}"`,
      entityId: detail._id,
      metadata: { projectId: String(detail.projectId) },
    });

    return res.status(200).json({
      message: "Detail archived successfully",
      data: detail.toObject(),
    });
  } catch (error) {
    console.error("deleteDetail error:", error);
    return res.status(500).json({ message: "Failed to archive detail" });
  }
};

exports.getEntries = async (req, res) => {
  try {
    const { from, to, clientId, projectId } = req.query;
    const range = parseDateRange(from, to);

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    const query = {
      userId: req.user._id,
      workDate: {
        $gte: range.start,
        $lt: range.endExclusive,
      },
    };

    if (clientId !== undefined) {
      if (!isValidObjectId(clientId)) {
        return res.status(400).json({ message: "Invalid clientId" });
      }

      query.clientId = clientId;
    }

    if (projectId !== undefined) {
      if (!isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Invalid projectId" });
      }

      query.projectId = projectId;
    }

    // We store workDate as Thailand local midnight converted to UTC so date-range
    // filtering also uses Thailand midnight boundaries and avoids day-shift bugs.
    const entries = await TimesheetEntry.find(query)
      .sort({ workDate: 1, createdAt: 1 })
      .populate("clientId", CLIENT_SELECT_FIELDS)
      .populate("projectId", "name clientId isActive")
      .lean();

    return res.status(200).json({
      range: { from: range.from, to: range.to },
      data: entries
        .filter((entry) => entry.projectId?.isActive)
        .map((entry) =>
          normalizeEntryOutput({
            ...entry,
            client: entry.clientId,
            project: entry.projectId,
          })
        ),
    });
  } catch (error) {
    console.error("getEntries error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet entries" });
  }
};

exports.createEntry = async (req, res) => {
  try {
    const { clientId, projectId, workDate, hours } = req.body;

    if (![clientId, projectId].every(isValidObjectId)) {
      return res.status(400).json({ message: "Valid clientId and projectId are required" });
    }

    const parsedHours = parseHours(hours);
    if (parsedHours === null || parsedHours <= 0 || parsedHours > 24) {
      return res.status(400).json({ message: "Hours must be greater than 0 and less than or equal to 24" });
    }

    const parsedWorkDate = parseWorkDate(workDate);
    if (!parsedWorkDate) {
      return res.status(400).json({ message: "Valid workDate is required in YYYY-MM-DD format" });
    }

    const access = await getTimesheetPeriodAccess({
      userId: req.user._id,
      workDate: parsedWorkDate,
    });
    if (!access.canEdit) {
      return respondPeriodAccessBlock(res, access);
    }

    const hierarchyError = await validateHierarchy({
      userId: req.user._id,
      clientId,
      projectId,
    });

    if (hierarchyError) {
      return res.status(hierarchyError.status).json({ message: hierarchyError.message });
    }

    const duplicate = await findEntryCollision({
      userId: req.user._id,
      projectId,
      workDate: parsedWorkDate,
    });

    if (duplicate) {
      const entry = await TimesheetEntry.findOneAndUpdate(
        { _id: duplicate._id, userId: req.user._id },
        { $set: { clientId, hours: parsedHours } },
        { new: true, runValidators: true }
      );

      await logTimesheetActivity({
        actor: req.user.username,
        action: "entry_updated",
        description: `Updated existing Timesheet entry to ${entry.hours} hours on ${formatWorkDate(entry.workDate)}`,
        entityId: entry._id,
        metadata: {
          projectId: String(entry.projectId),
          workDate: formatWorkDate(entry.workDate),
          hours: entry.hours,
          source: "create_entry_reuse",
        },
      });

      return res.status(200).json({
        message: "Timesheet entry updated successfully",
        reused: true,
        updated: true,
        data: normalizeEntryOutput(entry.toObject()),
      });
    }

    const entry = await TimesheetEntry.create({
      userId: req.user._id,
      clientId,
      projectId,
      workDate: parsedWorkDate,
      hours: parsedHours,
    });

    await logTimesheetActivity({
      actor: req.user.username,
      action: "entry_created",
      description: `Created Timesheet entry of ${entry.hours} hours on ${formatWorkDate(entry.workDate)}`,
      entityId: entry._id,
      metadata: { projectId: String(entry.projectId), workDate: formatWorkDate(entry.workDate), hours: entry.hours },
    });

    return res.status(201).json({
      message: "Timesheet entry created successfully",
      data: normalizeEntryOutput(entry.toObject()),
    });
  } catch (error) {
    console.error("createEntry error:", error);
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: TIMESHEET_ENTRY_DUPLICATE_MESSAGE,
      });
    }

    return res.status(500).json({ message: "Failed to create timesheet entry" });
  }
};

exports.updateEntry = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid entry id" });
    }

    const entry = await TimesheetEntry.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!entry) {
      return res.status(404).json({ message: "Timesheet entry not found" });
    }

    const nextClientId = req.body.clientId !== undefined ? req.body.clientId : String(entry.clientId);
    const nextProjectId =
      req.body.projectId !== undefined ? req.body.projectId : String(entry.projectId);

    if (![nextClientId, nextProjectId].every(isValidObjectId)) {
      return res.status(400).json({ message: "Valid clientId and projectId are required" });
    }

    const nextHours = req.body.hours !== undefined ? parseHours(req.body.hours) : entry.hours;
    if (nextHours === null || !Number.isFinite(nextHours) || nextHours <= 0 || nextHours > 24) {
      return res.status(400).json({ message: "Hours must be greater than 0 and less than or equal to 24" });
    }

    const nextWorkDate =
      req.body.workDate !== undefined ? parseWorkDate(req.body.workDate) : entry.workDate;
    if (!nextWorkDate) {
      return res.status(400).json({ message: "Valid workDate is required in YYYY-MM-DD format" });
    }

    const sourceAccess = await getTimesheetPeriodAccess({
      userId: req.user._id,
      workDate: entry.workDate,
    });
    if (!sourceAccess.canEdit) {
      return respondPeriodAccessBlock(res, sourceAccess);
    }

    const targetAccess = await getTimesheetPeriodAccess({
      userId: req.user._id,
      workDate: nextWorkDate,
    });
    if (!targetAccess.canEdit) {
      return respondPeriodAccessBlock(res, targetAccess);
    }

    const hierarchyError = await validateHierarchy({
      userId: req.user._id,
      clientId: nextClientId,
      projectId: nextProjectId,
    });

    if (hierarchyError) {
      return res.status(hierarchyError.status).json({ message: hierarchyError.message });
    }

    const duplicate = await findEntryCollision({
      userId: req.user._id,
      projectId: nextProjectId,
      workDate: nextWorkDate,
      excludeEntryId: entry._id,
    });

    if (duplicate) {
      return res.status(409).json({
        message: TIMESHEET_ENTRY_DUPLICATE_MESSAGE,
      });
    }

    const previousEntry = {
      hours: entry.hours,
      workDate: formatWorkDate(entry.workDate),
      projectId: String(entry.projectId),
    };
    entry.clientId = nextClientId;
    entry.projectId = nextProjectId;
    entry.workDate = nextWorkDate;
    entry.hours = nextHours;
    await entry.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "entry_updated",
      description: `Updated Timesheet entry from ${previousEntry.hours} to ${entry.hours} hours on ${formatWorkDate(entry.workDate)}`,
      entityId: entry._id,
      metadata: { previous: previousEntry, current: { hours: entry.hours, workDate: formatWorkDate(entry.workDate), projectId: String(entry.projectId) } },
    });

    return res.status(200).json({
      message: "Timesheet entry updated successfully",
      data: normalizeEntryOutput(entry.toObject()),
    });
  } catch (error) {
    console.error("updateEntry error:", error);
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: TIMESHEET_ENTRY_DUPLICATE_MESSAGE,
      });
    }

    return res.status(500).json({ message: "Failed to update timesheet entry" });
  }
};

exports.deleteEntry = async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid entry id" });
    }

    const entry = await TimesheetEntry.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!entry) {
      return res.status(404).json({ message: "Timesheet entry not found" });
    }

    const access = await getTimesheetPeriodAccess({
      userId: req.user._id,
      workDate: entry.workDate,
    });
    if (!access.canEdit) {
      return respondPeriodAccessBlock(res, access);
    }

    const deletedEntry = {
      projectId: String(entry.projectId),
      workDate: formatWorkDate(entry.workDate),
      hours: entry.hours,
    };
    await entry.deleteOne();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "entry_deleted",
      description: `Deleted Timesheet entry of ${deletedEntry.hours} hours on ${deletedEntry.workDate}`,
      entityId: entry._id,
      metadata: deletedEntry,
    });

    return res.status(200).json({ message: "Timesheet entry deleted successfully" });
  } catch (error) {
    console.error("deleteEntry error:", error);
    return res.status(500).json({ message: "Failed to delete timesheet entry" });
  }
};

exports.createSubmission = async (req, res) => {
  try {
    const period = getWeeklyPeriod(req.body?.periodStart);
    if (!period) {
      return res.status(400).json({
        message: "periodStart must be a valid Monday in YYYY-MM-DD format",
      });
    }

    const access = await getTimesheetPeriodAccess({
      userId: req.user._id,
      periodStart: period.periodStartKey,
    });
    if (!access.canSubmit) {
      return respondPeriodAccessBlock(res, access);
    }

    const approvalSteps = await buildApprovalStepsSnapshot(req.user);
    if (!approvalSteps) {
      return res.status(422).json({
        message: "No approval flow is configured for this user",
      });
    }

    const activeOverlap = await TimesheetSubmission.findOne({
      userId: req.user._id,
      status: { $in: ACTIVE_SUBMISSION_STATUSES },
      periodStart: { $lte: period.periodEnd },
      periodEnd: { $gte: period.periodStart },
    })
      .select("_id")
      .lean();
    if (activeOverlap) {
      return res.status(409).json({
        message: "An active timesheet submission already exists for this period",
      });
    }

    const totals = await TimesheetEntry.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(req.user._id),
          workDate: { $gte: period.periodStart, $lte: period.periodEnd },
        },
      },
      {
        $lookup: {
          from: "timesheetprojects",
          localField: "projectId",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: "$project" },
      { $match: { "project.isActive": true } },
      { $group: { _id: null, totalHours: { $sum: "$hours" } } },
    ]);
    const totalHours = Number((totals[0]?.totalHours || 0).toFixed(2));

    if (totalHours <= 0) {
      return res.status(422).json({
        message: "Timesheet period must contain at least one hour before submission",
      });
    }

    const submission = await TimesheetSubmission.create({
      userId: req.user._id,
      periodType: period.periodType,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      status: "pending",
      totalHours,
      currentApprovalLevel: approvalSteps[0].level,
      approvalSteps,
      submittedAt: new Date(),
    });

    await logTimesheetActivity({
      actor: req.user.username,
      action: "submission_created",
      description: `Submitted Timesheet for ${period.periodStartKey} - ${period.periodEndKey}`,
      entityId: submission._id,
      metadata: { periodStart: period.periodStartKey, periodEnd: period.periodEndKey, totalHours },
    });

    return res.status(201).json({
      message: "Timesheet submitted successfully",
      data: buildSubmissionResponse(submission.toObject()),
    });
  } catch (error) {
    console.error("createSubmission error:", error);
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: "An active timesheet submission already exists for this period",
      });
    }

    return res.status(500).json({ message: "Failed to submit timesheet" });
  }
};

exports.reopenTimesheetPeriod = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "Admin access is required" });
    }

    const { userId, periodStart, reopenUntil, reason } = req.body || {};
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const targetUser = await User.findById(userId, "_id").lean();
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const period = getWeeklyPeriod(periodStart);
    if (!period) {
      return res.status(400).json({
        message: "periodStart must be a valid Monday in YYYY-MM-DD format",
      });
    }

    const parsedReopenUntil = parseWorkDate(reopenUntil);
    if (!parsedReopenUntil) {
      return res.status(400).json({
        message: "reopenUntil must be a valid date in YYYY-MM-DD format",
      });
    }

    const trimmedReason = String(reason || "").trim();
    if (!trimmedReason) {
      return res.status(400).json({ message: "A reopen reason is required" });
    }

    const access = await getTimesheetPeriodAccess({
      userId,
      periodStart: period.periodStartKey,
    });
    if (!access.isExpired) {
      return res.status(409).json({
        message: "This timesheet period is not past the submission deadline",
      });
    }

    const today = getThailandDateKey();
    if (formatWorkDate(parsedReopenUntil) < today) {
      return res.status(400).json({
        message: "reopenUntil cannot be before today in Asia/Bangkok",
      });
    }

    // Close only stale records so a new audit record can be created after expiry.
    await TimesheetPeriodOverride.updateMany(
      {
        userId,
        periodType: "week",
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        isActive: true,
        reopenUntil: { $lt: parseWorkDate(today) },
      },
      { $set: { isActive: false, closedAt: new Date() } }
    );

    const activeOverride = await TimesheetPeriodOverride.exists({
      userId,
      periodType: "week",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      isActive: true,
    });
    if (activeOverride) {
      return res.status(409).json({
        message: "An active reopen already exists for this timesheet period",
      });
    }

    const override = await TimesheetPeriodOverride.create({
      userId,
      periodType: "week",
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      reopenedBy: req.user._id,
      reopenedAt: new Date(),
      reopenUntil: parsedReopenUntil,
      reason: trimmedReason,
      isActive: true,
    });

    await logTimesheetActivity({
      actor: req.user.username,
      action: "period_reopened",
      description: `Reopened Timesheet period ${period.periodStartKey} - ${period.periodEndKey} until ${formatWorkDate(override.reopenUntil)}`,
      entityId: override._id,
      metadata: { userId: String(userId), periodStart: period.periodStartKey, periodEnd: period.periodEndKey, reopenUntil: formatWorkDate(override.reopenUntil), reason: override.reason },
    });

    return res.status(201).json({
      message: "Timesheet period reopened successfully",
      data: {
        _id: override._id,
        userId: String(override.userId),
        periodStart: period.periodStartKey,
        periodEnd: period.periodEndKey,
        deadline: access.deadline,
        reopenUntil: formatWorkDate(override.reopenUntil),
        reason: override.reason,
      },
    });
  } catch (error) {
    console.error("reopenTimesheetPeriod error:", error);
    if (isDuplicateKeyError(error)) {
      return res.status(409).json({
        message: "An active reopen already exists for this timesheet period",
      });
    }

    return res.status(500).json({ message: "Failed to reopen timesheet period" });
  }
};

exports.getAdminReopenStatus = async (req, res) => {
  try {
    if (!isAdmin(req.user)) {
      return res.status(403).json({ message: "Admin access is required" });
    }

    const { userId, periodStart } = req.query;
    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Valid userId is required" });
    }

    const targetUser = await User.findById(userId, "_id").lean();
    if (!targetUser) {
      return res.status(404).json({ message: "Target user not found" });
    }

    const access = await getTimesheetPeriodAccess({ userId, periodStart });
    if (!access) {
      return res.status(400).json({
        message: "periodStart must be a valid Monday in YYYY-MM-DD format",
      });
    }

    return res.status(200).json({
      userId: String(userId),
      periodStart: access.periodStart,
      periodEnd: access.periodEnd,
      deadline: access.deadline,
      isExpired: access.isExpired,
      isReopened: access.isReopened,
      reopenUntil: access.reopenUntil,
      reason: access.override?.reason || null,
      reopenedAt: access.override?.reopenedAt || null,
      reopenedBy: access.override?.reopenedBy
        ? {
            _id: String(access.override.reopenedBy._id),
            username: formatUserDisplayName(access.override.reopenedBy),
          }
        : null,
    });
  } catch (error) {
    console.error("getAdminReopenStatus error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet reopen status" });
  }
};

exports.getMyPeriodStatus = async (req, res) => {
  try {
    const access = await getTimesheetPeriodAccess({
      userId: req.user._id,
      periodStart: req.query.periodStart,
    });
    if (!access) {
      return res.status(400).json({
        message: "periodStart must be a valid Monday in YYYY-MM-DD format",
      });
    }

    return res.status(200).json({
      periodStart: access.periodStart,
      periodEnd: access.periodEnd,
      deadline: access.deadline,
      isExpired: access.isExpired,
      isReopened: access.isReopened,
      reopenUntil: access.reopenUntil,
      submissionStatus: access.submissionStatus,
      canEdit: access.canEdit,
      canSubmit: access.canSubmit,
      lockReason: access.lockReason,
    });
  } catch (error) {
    console.error("getMyPeriodStatus error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet period status" });
  }
};

exports.getMySubmissions = async (req, res) => {
  try {
    const { from, to, status } = req.query;
    const query = { userId: req.user._id };

    if (status !== undefined) {
      if (!SUBMISSION_STATUSES.includes(status)) {
        return res.status(400).json({ message: "Invalid submission status" });
      }
      query.status = status;
    }

    if (from !== undefined || to !== undefined) {
      const range = parseDateRange(from, to);
      if (!range) {
        return res.status(400).json({ message: "Valid from and to dates are required" });
      }

      query.periodStart = { $lt: range.endExclusive };
      query.periodEnd = { $gte: range.start };
    }

    const submissions = await TimesheetSubmission.find(query)
      .sort({ submittedAt: -1, createdAt: -1 })
      .lean();

    return res.status(200).json({
      data: submissions.map(buildSubmissionResponse),
    });
  } catch (error) {
    console.error("getMySubmissions error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet submissions" });
  }
};

exports.getMySubmissionDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const submission = await TimesheetSubmission.findOne({
      _id: id,
      userId: req.user._id,
    }).lean();
    if (!submission) {
      return res.status(404).json({ message: "Timesheet submission not found" });
    }

    return res.status(200).json({ data: buildSubmissionResponse(submission) });
  } catch (error) {
    console.error("getMySubmissionDetail error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet submission" });
  }
};

exports.withdrawSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const submission = await TimesheetSubmission.findOne({
      _id: id,
      userId: req.user._id,
    });
    if (!submission) {
      return res.status(404).json({ message: "Timesheet submission not found" });
    }

    if (submission.status !== "pending") {
      return res.status(409).json({
        message: "Only pending timesheet submissions can be withdrawn",
      });
    }

    if (submission.approvalSteps.some((step) => step.status === "approved")) {
      return res.status(409).json({
        message: "A timesheet submission cannot be withdrawn after approval has started",
      });
    }

    submission.status = "withdrawn";
    submission.withdrawnAt = new Date();
    submission.currentApprovalLevel = null;
    await submission.save();

    await logTimesheetActivity({
      actor: req.user.username,
      action: "submission_withdrawn",
      description: `Withdrew Timesheet submission for ${formatWorkDate(submission.periodStart)} - ${formatWorkDate(submission.periodEnd)}`,
      entityId: submission._id,
      metadata: { periodStart: formatWorkDate(submission.periodStart), periodEnd: formatWorkDate(submission.periodEnd) },
    });

    return res.status(200).json({
      message: "Timesheet submission withdrawn successfully",
      data: buildSubmissionResponse(submission.toObject()),
    });
  } catch (error) {
    console.error("withdrawSubmission error:", error);
    return res.status(500).json({ message: "Failed to withdraw timesheet submission" });
  }
};

exports.getApprovalInbox = async (req, res) => {
  try {
    const { from, to } = req.query;
    const identityConditions = [];

    if (req.user?._id) {
      identityConditions.push({
        approvalSteps: {
          $elemMatch: { status: "pending", approverUserId: req.user._id },
        },
      });
    }

    if (normalizeUsername(req.user?.username)) {
      identityConditions.push({
        approvalSteps: {
          $elemMatch: {
            status: "pending",
            approverUserId: null,
            approverUsername: new RegExp(
              `^${escapeRegex(req.user.username)}$`,
              "i"
            ),
          },
        },
      });
    }

    if (identityConditions.length === 0) {
      return res.status(200).json({ data: [] });
    }

    const query = { status: "pending", $or: identityConditions };
    if (from !== undefined || to !== undefined) {
      const range = parseDateRange(from, to);
      if (!range) {
        return res.status(400).json({ message: "Valid from and to dates are required" });
      }

      query.periodStart = { $lt: range.endExclusive };
      query.periodEnd = { $gte: range.start };
    }

    const candidates = await TimesheetSubmission.find(query)
      .populate("userId", "username firstName lastName department")
      .sort({ submittedAt: 1, createdAt: 1 })
      .lean();
    const submissions = candidates.filter((submission) => {
      const current = getCurrentApprovalStep(submission);
      return current && matchesApprovalStep(current.step, req.user);
    });

    return res.status(200).json({
      data: submissions.map((submission) => ({
        _id: submission._id,
        userId: submission.userId?._id || submission.userId,
        user: submission.userId
          ? {
              _id: submission.userId._id,
              username: formatUserDisplayName(submission.userId),
              department: submission.userId.department || "",
            }
          : null,
        periodStart: formatWorkDate(submission.periodStart),
        periodEnd: formatWorkDate(submission.periodEnd),
        totalHours: submission.totalHours,
        currentApprovalLevel: submission.currentApprovalLevel,
        submittedAt: submission.submittedAt,
      })),
    });
  } catch (error) {
    console.error("getApprovalInbox error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet approvals" });
  }
};

exports.getApprovalDetail = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const submission = await TimesheetSubmission.findById(id).lean();
    if (!submission) {
      return res.status(404).json({ message: "Timesheet submission not found" });
    }

    const current = getCurrentApprovalStep(submission);
    if (!current || !matchesApprovalStep(current.step, req.user)) {
      return res.status(403).json({
        message: "You are not authorized to approve this timesheet",
      });
    }

    const submitter = await User.findById(
      submission.userId,
      "_id username firstName lastName department"
    ).lean();
    if (!submitter) {
      return res.status(404).json({ message: "Timesheet submitter not found" });
    }

    const range = parseDateRange(
      formatWorkDate(submission.periodStart),
      formatWorkDate(submission.periodEnd)
    );
    const currentSummary = await getTimesheetSummaryForUser(submission.userId, range);

    return res.status(200).json({
      submission: buildSubmissionResponse(submission),
      user: {
        _id: submitter._id,
        username: formatUserDisplayName(submitter),
        department: submitter.department || "",
      },
      summary: {
        ...currentSummary,
        submittedTotalHours: submission.totalHours,
        currentTotalHours: currentSummary.totalHours,
        hasTotalHoursMismatch:
          Number(submission.totalHours) !== Number(currentSummary.totalHours),
      },
    });
  } catch (error) {
    console.error("getApprovalDetail error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet approval" });
  }
};

exports.approveSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const submission = await TimesheetSubmission.findById(id).lean();
    if (!submission) {
      return res.status(404).json({ message: "Timesheet submission not found" });
    }

    const current = getCurrentApprovalStep(submission);
    if (!current) {
      return res.status(409).json({
        message: "This timesheet submission is no longer actionable",
      });
    }

    if (!matchesApprovalStep(current.step, req.user)) {
      return res.status(403).json({
        message: "You are not authorized to approve this timesheet",
      });
    }

    const comment = String(req.body?.comment || "").trim();
    const nextIndex = submission.approvalSteps.findIndex(
      (step, index) => index > current.index && step.status === "waiting"
    );
    const now = new Date();
    const currentPath = `approvalSteps.${current.index}`;
    const update = {
      $set: {
        [`${currentPath}.status`]: "approved",
        [`${currentPath}.actedAt`]: now,
        [`${currentPath}.comment`]: comment,
        latestComment: comment,
      },
    };

    if (nextIndex === -1) {
      update.$set.status = "approved";
      update.$set.currentApprovalLevel = null;
      update.$set.approvedAt = now;
    } else {
      const next = submission.approvalSteps[nextIndex];
      update.$set[`approvalSteps.${nextIndex}.status`] = "pending";
      update.$set.currentApprovalLevel = next.level;
    }

    const updated = await TimesheetSubmission.findOneAndUpdate(
      buildApprovalActionFilter({ submission, current, viewer: req.user }),
      update,
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({
        message: "This timesheet submission is no longer actionable",
      });
    }

    await logTimesheetActivity({
      actor: req.user.username,
      action: "submission_approved",
      description: `Approved Timesheet at level ${current.step.level}`,
      entityId: updated._id,
      metadata: { periodStart: formatWorkDate(updated.periodStart), periodEnd: formatWorkDate(updated.periodEnd), level: current.step.level },
    });
    if (nextIndex === -1) {
      await logTimesheetActivity({
        actor: req.user.username,
        action: "submission_fully_approved",
        description: `Final approval completed for Timesheet ${formatWorkDate(updated.periodStart)} - ${formatWorkDate(updated.periodEnd)}`,
        entityId: updated._id,
        metadata: { periodStart: formatWorkDate(updated.periodStart), periodEnd: formatWorkDate(updated.periodEnd) },
      });
    }

    return res.status(200).json({
      message: "Timesheet submission approved successfully",
      data: buildSubmissionResponse(updated.toObject()),
    });
  } catch (error) {
    console.error("approveSubmission error:", error);
    return res.status(500).json({ message: "Failed to approve timesheet submission" });
  }
};

exports.rejectSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    const reason = String(req.body?.reason || "").trim();
    if (!reason) {
      return res.status(400).json({ message: "Rejection reason is required" });
    }

    if (reason.length > 1000) {
      return res.status(400).json({ message: "Rejection reason is too long" });
    }

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid submission id" });
    }

    const submission = await TimesheetSubmission.findById(id).lean();
    if (!submission) {
      return res.status(404).json({ message: "Timesheet submission not found" });
    }

    const current = getCurrentApprovalStep(submission);
    if (!current) {
      return res.status(409).json({
        message: "This timesheet submission is no longer actionable",
      });
    }

    if (!matchesApprovalStep(current.step, req.user)) {
      return res.status(403).json({
        message: "You are not authorized to approve this timesheet",
      });
    }

    const now = new Date();
    const currentPath = `approvalSteps.${current.index}`;
    const updated = await TimesheetSubmission.findOneAndUpdate(
      buildApprovalActionFilter({ submission, current, viewer: req.user }),
      {
        $set: {
          [`${currentPath}.status`]: "rejected",
          [`${currentPath}.actedAt`]: now,
          [`${currentPath}.comment`]: reason,
          status: "rejected",
          currentApprovalLevel: null,
          rejectedAt: now,
          rejectionReason: reason,
          latestComment: reason,
        },
      },
      { new: true }
    );
    if (!updated) {
      return res.status(409).json({
        message: "This timesheet submission is no longer actionable",
      });
    }

    await logTimesheetActivity({
      actor: req.user.username,
      action: "submission_rejected",
      description: `Rejected Timesheet: ${reason}`,
      entityId: updated._id,
      metadata: { periodStart: formatWorkDate(updated.periodStart), periodEnd: formatWorkDate(updated.periodEnd), reason },
    });

    return res.status(200).json({
      message: "Timesheet submission rejected successfully",
      data: buildSubmissionResponse(updated.toObject()),
    });
  } catch (error) {
    console.error("rejectSubmission error:", error);
    return res.status(500).json({ message: "Failed to reject timesheet submission" });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = parseDateRange(from, to);

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    return res.status(200).json(
      await getTimesheetSummaryForUser(req.user._id, range)
    );
  } catch (error) {
    console.error("getSummary error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet summary" });
  }
};

exports.getDashboardUsers = async (req, res) => {
  try {
    const result = await getVisibleDashboardUsers(req.user);

    return res.status(200).json({
      canViewDashboard: result.canViewDashboard,
      scope: result.scope,
      data: result.data,
    });
  } catch (error) {
    console.error("getDashboardUsers error:", error);
    return res.status(500).json({ message: "Failed to fetch dashboard users" });
  }
};

exports.getTimesheetCapabilities = async (req, res) => {
  try {
    const [dashboardScope, canApproveTimesheet] = await Promise.all([
      getViewerDashboardScope(req.user),
      canUserApproveTimesheets(req.user),
    ]);

    return res.status(200).json({
      canViewDashboard: dashboardScope.canViewDashboard,
      canApproveTimesheet,
    });
  } catch (error) {
    console.error("getTimesheetCapabilities error:", error);
    return res.status(500).json({ message: "Failed to fetch timesheet capabilities" });
  }
};

exports.getDashboardSummary = async (req, res) => {
  try {
    const { from, to, userId, clientId, projectId } = req.query;
    const range = parseDateRange(from, to);

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    const dashboardAccess = await getVisibleDashboardUsers(req.user);
    if (!dashboardAccess.canViewDashboard) {
      return res.status(403).json({ message: "You do not have permission to view the timesheet dashboard" });
    }

    let visibleUserIds = dashboardAccess.visibleUserIds.map(String);

    if (userId !== undefined) {
      if (!isValidObjectId(userId)) {
        return res.status(400).json({ message: "Invalid userId" });
      }

      if (!visibleUserIds.includes(String(userId))) {
        return res.status(403).json({ message: "You do not have permission to view this user's timesheet" });
      }

      visibleUserIds = [String(userId)];
    }

    const match = {
      userId: { $in: visibleUserIds.map((id) => new mongoose.Types.ObjectId(id)) },
      workDate: {
        $gte: range.start,
        $lt: range.endExclusive,
      },
    };

    if (clientId !== undefined) {
      if (!isValidObjectId(clientId)) {
        return res.status(400).json({ message: "Invalid clientId" });
      }

      match.clientId = new mongoose.Types.ObjectId(clientId);
    }

    if (projectId !== undefined) {
      if (!isValidObjectId(projectId)) {
        return res.status(400).json({ message: "Invalid projectId" });
      }

      match.projectId = new mongoose.Types.ObjectId(projectId);
    }

    const summary = await TimesheetEntry.aggregate([
      { $match: match },
      {
        $lookup: {
          from: "timesheetprojects",
          localField: "projectId",
          foreignField: "_id",
          as: "project",
        },
      },
      { $unwind: "$project" },
      { $match: { "project.isActive": true } },
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      {
        $group: {
          _id: "$userId",
          firstName: { $first: "$user.firstName" },
          lastName: { $first: "$user.lastName" },
          username: { $first: "$user.username" },
          department: { $first: "$user.department" },
          totalHours: { $sum: "$hours" },
        },
      },
      { $sort: { username: 1 } },
    ]);

    return res.status(200).json({
      range: { from: range.from, to: range.to },
      totalUsers: summary.length,
      totalHours: Number(
        summary.reduce((acc, item) => acc + Number(item.totalHours || 0), 0).toFixed(2)
      ),
      users: summary.map((item) => ({
        userId: item._id,
        username: formatUserDisplayName(item),
        department: item.department || "",
        totalHours: Number(Number(item.totalHours || 0).toFixed(2)),
      })),
    });
  } catch (error) {
    console.error("getDashboardSummary error:", error);
    return res.status(500).json({ message: "Failed to fetch dashboard summary" });
  }
};

exports.getDashboardExportData = async (req, res) => {
  try {
    const {
      from,
      to,
      userId: rawUserId,
      clientId: rawClientId,
      projectId: rawProjectId,
      department: rawDepartment,
      team: rawTeam,
      search: rawSearch,
    } = req.query;
    const range = parseDateRange(from, to);

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    const dates = buildDailyKeys(range);
    if (dates.length > MAX_DASHBOARD_EXPORT_DAYS) {
      return res.status(400).json({
        message: `Date range must not exceed ${MAX_DASHBOARD_EXPORT_DAYS} days`,
      });
    }

    const optionalStrings = {
      userId: rawUserId,
      clientId: rawClientId,
      projectId: rawProjectId,
      department: rawDepartment,
      team: rawTeam,
      search: rawSearch,
    };

    for (const [name, value] of Object.entries(optionalStrings)) {
      if (value !== undefined && typeof value !== "string") {
        return res.status(400).json({ message: `${name} must be a string` });
      }
    }

    const userId = String(rawUserId || "").trim();
    const clientId = String(rawClientId || "").trim();
    const projectId = String(rawProjectId || "").trim();
    const department = String(rawDepartment || "").trim().toLowerCase();
    const team = String(rawTeam || "").trim().toLowerCase();
    const search = String(rawSearch || "").trim().toLowerCase();

    for (const [name, value] of Object.entries({ userId, clientId, projectId })) {
      if (value && !isValidObjectId(value)) {
        return res.status(400).json({ message: `Invalid ${name}` });
      }
    }

    const dashboardAccess = await getVisibleDashboardUsers(req.user);
    if (!dashboardAccess.canViewDashboard) {
      return res.status(403).json({
        message: "You do not have permission to view the timesheet dashboard",
      });
    }

    const visibleUserIds = new Set(dashboardAccess.visibleUserIds.map(String));
    if (userId && !visibleUserIds.has(userId)) {
      return res.status(403).json({
        message: "You do not have permission to view this user's timesheet",
      });
    }

    const selectedUsers = dashboardAccess.data.filter((user) => {
      const selectedUserId = String(user._id);
      if (userId && selectedUserId !== userId) {
        return false;
      }

      if (department && String(user.department || "").trim().toLowerCase() !== department) {
        return false;
      }

      if (team && String(user.team || "").trim().toLowerCase() !== team) {
        return false;
      }

      if (search) {
        const searchableText = String(user.username || "").toLowerCase();

        if (!searchableText.includes(search)) {
          return false;
        }
      }

      return true;
    });

    const selectedUserIds = selectedUsers.map(
      (user) => new mongoose.Types.ObjectId(user._id)
    );
    const aggregated = selectedUserIds.length
      ? await aggregateHierarchicalSummary({
          userIds: selectedUserIds,
          range,
          clientId: clientId ? new mongoose.Types.ObjectId(clientId) : undefined,
          projectId: projectId ? new mongoose.Types.ObjectId(projectId) : undefined,
          includeInactiveProjects: true,
        })
      : { totalHours: 0, users: [] };

    const rows = aggregated.users.flatMap((user) =>
      user.clients.flatMap((client) =>
        client.projects.map((project) => ({
          userId: user.userId,
          employeeName: user.username,
          department: user.department,
          clientId: client.clientId,
          clientName: client.clientName,
          projectId: project.projectId,
          projectName: project.name,
          dailyHours: project.dailyHours,
          totalHours: project.totalHours,
        }))
      )
    );
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    return res.status(200).json({
      range: { from: range.from, to: range.to },
      dates: dates.map((date) => ({
        date,
        day: dayNames[new Date(`${date}T00:00:00.000Z`).getUTCDay()],
      })),
      totalRows: rows.length,
      totalHours: aggregated.totalHours,
      rows,
    });
  } catch (error) {
    console.error("getDashboardExportData error:", error);
    return res.status(500).json({ message: "Failed to fetch dashboard export data" });
  }
};

exports.getDashboardUserSummary = async (req, res) => {
  try {
    const { userId } = req.params;
    const { from, to } = req.query;
    const range = parseDateRange(from, to);

    if (!isValidObjectId(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    const targetUser = await User.findById(
      userId,
      "_id username firstName lastName department team teamGroup flow role"
    ).lean();

    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const permitted = await canViewTimesheet(req.user, targetUser);
    if (!permitted) {
      return res.status(403).json({ message: "You do not have permission to view this user's timesheet" });
    }

    const aggregated = await aggregateHierarchicalSummary({
      userIds: [targetUser._id],
      range,
    });
    const userSummary = aggregated.users[0];

    return res.status(200).json({
      user: {
        _id: targetUser._id,
        username: formatUserDisplayName(targetUser),
        department: targetUser.department || "",
      },
      range: { from: range.from, to: range.to },
      totalHours: aggregated.totalHours,
      clients: userSummary?.clients || [],
    });
  } catch (error) {
    console.error("getDashboardUserSummary error:", error);
    return res.status(500).json({ message: "Failed to fetch user dashboard summary" });
  }
};
