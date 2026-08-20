const mongoose = require("mongoose");
const Client = require("../models/Client");
const User = require("../models/User");
const TimesheetProject = require("../models/TimesheetProject");
const TimesheetDetail = require("../models/TimesheetDetail");
const TimesheetEntry = require("../models/TimesheetEntry");
const {
  canViewTimesheet,
  getVisibleDashboardUsers,
} = require("../services/timesheetPermissionService");
const {
  normalizeScopedName,
  parseDateRange,
  parseWorkDate,
  formatWorkDate,
} = require("../utils/timesheet");

const CLIENT_SELECT_FIELDS =
  "customerName companyBaseName email authorizedApprovers address taxIdentificationNumber contactPhoneNumber branchNo";

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const isDuplicateKeyError = (error) => error?.code === 11000;

const trimName = (value) => String(value || "").trim().replace(/\s+/g, " ");

const normalizeEntryOutput = (entry) => ({
  ...entry,
  workDate: formatWorkDate(entry.workDate),
});

const buildProjectResponse = (project) => ({
  ...project,
  clientId: project.clientId,
});

const buildDetailResponse = (detail) => ({
  ...detail,
  projectId: detail.projectId,
});

const TIMESHEET_ENTRY_DUPLICATE_MESSAGE =
  "A timesheet entry already exists for this detail and date";

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

const aggregateHierarchicalSummary = async ({ userIds, range }) => {
  const summary = await TimesheetEntry.aggregate([
    {
      $match: {
        userId: { $in: userIds },
        workDate: {
          $gte: range.start,
          $lt: range.endExclusive,
        },
      },
    },
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
    {
      $lookup: {
        from: "timesheetdetails",
        localField: "detailId",
        foreignField: "_id",
        as: "detail",
      },
    },
    { $unwind: "$user" },
    { $unwind: "$client" },
    { $unwind: "$project" },
    { $unwind: "$detail" },
    {
      $group: {
        _id: {
          userId: "$userId",
          clientId: "$clientId",
          projectId: "$projectId",
          detailId: "$detailId",
          workDate: "$workDate",
        },
        username: { $first: "$user.username" },
        department: { $first: "$user.department" },
        clientName: { $first: "$client.customerName" },
        projectName: { $first: "$project.name" },
        detailName: { $first: "$detail.name" },
        dayHours: { $sum: "$hours" },
      },
    },
    {
      $sort: {
        username: 1,
        clientName: 1,
        projectName: 1,
        detailName: 1,
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
    const detailKey = String(item._id.detailId);
    const workDateKey = formatWorkDate(item._id.workDate);

    if (!usersMap.has(userKey)) {
      usersMap.set(userKey, {
        userId: item._id.userId,
        username: item.username,
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
      clientNode.projectMap.set(projectKey, {
        projectId: item._id.projectId,
        name: item.projectName,
        totalHours: 0,
        details: [],
        detailMap: new Map(),
      });
      clientNode.projects.push(clientNode.projectMap.get(projectKey));
    }

    const projectNode = clientNode.projectMap.get(projectKey);
    projectNode.totalHours += item.dayHours;

    if (!projectNode.detailMap.has(detailKey)) {
      const dailyHours = {};
      dailyKeys.forEach((key) => {
        dailyHours[key] = 0;
      });

      projectNode.detailMap.set(detailKey, {
        detailId: item._id.detailId,
        name: item.detailName,
        dailyHours,
        totalHours: 0,
      });
      projectNode.details.push(projectNode.detailMap.get(detailKey));
    }

    const detailNode = projectNode.detailMap.get(detailKey);
    detailNode.dailyHours[workDateKey] = Number(
      (detailNode.dailyHours[workDateKey] + item.dayHours).toFixed(2)
    );
    detailNode.totalHours += item.dayHours;
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
        totalHours: Number(project.totalHours.toFixed(2)),
        details: project.details.map((detail) => ({
          detailId: detail.detailId,
          name: detail.name,
          dailyHours: detail.dailyHours,
          totalHours: Number(detail.totalHours.toFixed(2)),
        })),
      })),
    })),
  }));

  return {
    totalHours: Number(totalHours.toFixed(2)),
    users,
  };
};

const ensureClientExists = async (clientId) => {
  const client = await Client.findById(clientId).select("_id").lean();
  if (!client) {
    return { status: 400, message: "Client not found" };
  }

  return null;
};

const validateHierarchy = async ({ userId, clientId, projectId, detailId }) => {
  const [client, project, detail] = await Promise.all([
    Client.findById(clientId).select("_id").lean(),
    TimesheetProject.findOne({ _id: projectId, userId })
      .select("_id clientId isActive")
      .lean(),
    TimesheetDetail.findOne({ _id: detailId, userId })
      .select("_id projectId isActive")
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

  if (!detail) {
    return { status: 400, message: "Selected detail was not found" };
  }

  if (String(detail.projectId) !== String(projectId)) {
    return { status: 400, message: "Detail does not belong to the selected project" };
  }

  if (!detail.isActive) {
    return { status: 400, message: "Selected detail is archived" };
  }

  return null;
};

const findEntryCollision = async ({
  userId,
  detailId,
  workDate,
  excludeEntryId = null,
}) => {
  const query = {
    userId,
    detailId,
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

    if (!isValidObjectId(clientId)) {
      return res.status(400).json({ message: "Valid clientId is required" });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: "Project name is required" });
    }

    const clientError = await ensureClientExists(clientId);
    if (clientError) {
      return res.status(clientError.status).json({ message: clientError.message });
    }

    const normalizedName = normalizeScopedName(trimmedName);
    const duplicate = await TimesheetProject.findOne({
      userId: req.user._id,
      clientId,
      normalizedName,
    }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A project with this name already exists for this client" });
    }

    const project = await TimesheetProject.create({
      userId: req.user._id,
      clientId,
      name: trimmedName,
      normalizedName,
    });

    return res.status(201).json({
      message: "Project created successfully",
      data: project.toObject(),
    });
  } catch (error) {
    console.error("createProject error:", error);
    if (isDuplicateKeyError(error)) {
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
    const trimmedName = trimName(req.body.name);

    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid project id" });
    }

    if (!trimmedName) {
      return res.status(400).json({ message: "Project name is required" });
    }

    const project = await TimesheetProject.findOne({
      _id: id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({ message: "Project not found" });
    }

    const normalizedName = normalizeScopedName(trimmedName);
    const duplicate = await TimesheetProject.findOne({
      _id: { $ne: project._id },
      userId: req.user._id,
      clientId: project.clientId,
      normalizedName,
    }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A project with this name already exists for this client" });
    }

    project.name = trimmedName;
    project.normalizedName = normalizedName;
    await project.save();

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
    }).lean();

    if (duplicate) {
      return res
        .status(409)
        .json({ message: "A detail with this name already exists for this project" });
    }

    detail.name = trimmedName;
    detail.normalizedName = normalizedName;
    await detail.save();

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
    const { from, to, clientId, projectId, detailId } = req.query;
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

    if (detailId !== undefined) {
      if (!isValidObjectId(detailId)) {
        return res.status(400).json({ message: "Invalid detailId" });
      }

      query.detailId = detailId;
    }

    // We store workDate as Thailand local midnight converted to UTC so date-range
    // filtering also uses Thailand midnight boundaries and avoids day-shift bugs.
    const entries = await TimesheetEntry.find(query)
      .sort({ workDate: 1, createdAt: 1 })
      .populate("clientId", CLIENT_SELECT_FIELDS)
      .populate("projectId", "name clientId isActive")
      .populate("detailId", "name projectId isActive")
      .lean();

    return res.status(200).json({
      range: { from: range.from, to: range.to },
      data: entries.map((entry) =>
        normalizeEntryOutput({
          ...entry,
          client: entry.clientId,
          project: entry.projectId,
          detail: entry.detailId,
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
    const { clientId, projectId, detailId, workDate, hours } = req.body;

    if (![clientId, projectId, detailId].every(isValidObjectId)) {
      return res.status(400).json({ message: "Valid clientId, projectId and detailId are required" });
    }

    const parsedHours = Number(hours);
    if (!Number.isFinite(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      return res.status(400).json({ message: "Hours must be greater than 0 and less than or equal to 24" });
    }

    const parsedWorkDate = parseWorkDate(workDate);
    if (!parsedWorkDate) {
      return res.status(400).json({ message: "Valid workDate is required in YYYY-MM-DD format" });
    }

    const hierarchyError = await validateHierarchy({
      userId: req.user._id,
      clientId,
      projectId,
      detailId,
    });

    if (hierarchyError) {
      return res.status(hierarchyError.status).json({ message: hierarchyError.message });
    }

    const duplicate = await findEntryCollision({
      userId: req.user._id,
      detailId,
      workDate: parsedWorkDate,
    });

    if (duplicate) {
      return res.status(409).json({
        message: TIMESHEET_ENTRY_DUPLICATE_MESSAGE,
      });
    }

    const entry = await TimesheetEntry.create({
      userId: req.user._id,
      clientId,
      projectId,
      detailId,
      workDate: parsedWorkDate,
      hours: parsedHours,
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
    const nextDetailId = req.body.detailId !== undefined ? req.body.detailId : String(entry.detailId);

    if (![nextClientId, nextProjectId, nextDetailId].every(isValidObjectId)) {
      return res.status(400).json({ message: "Valid clientId, projectId and detailId are required" });
    }

    const nextHours = req.body.hours !== undefined ? Number(req.body.hours) : entry.hours;
    if (!Number.isFinite(nextHours) || nextHours <= 0 || nextHours > 24) {
      return res.status(400).json({ message: "Hours must be greater than 0 and less than or equal to 24" });
    }

    const nextWorkDate =
      req.body.workDate !== undefined ? parseWorkDate(req.body.workDate) : entry.workDate;
    if (!nextWorkDate) {
      return res.status(400).json({ message: "Valid workDate is required in YYYY-MM-DD format" });
    }

    const hierarchyError = await validateHierarchy({
      userId: req.user._id,
      clientId: nextClientId,
      projectId: nextProjectId,
      detailId: nextDetailId,
    });

    if (hierarchyError) {
      return res.status(hierarchyError.status).json({ message: hierarchyError.message });
    }

    const duplicate = await findEntryCollision({
      userId: req.user._id,
      detailId: nextDetailId,
      workDate: nextWorkDate,
      excludeEntryId: entry._id,
    });

    if (duplicate) {
      return res.status(409).json({
        message: TIMESHEET_ENTRY_DUPLICATE_MESSAGE,
      });
    }

    entry.clientId = nextClientId;
    entry.projectId = nextProjectId;
    entry.detailId = nextDetailId;
    entry.workDate = nextWorkDate;
    entry.hours = nextHours;
    await entry.save();

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

    const deleted = await TimesheetEntry.findOneAndDelete({
      _id: id,
      userId: req.user._id,
    });

    if (!deleted) {
      return res.status(404).json({ message: "Timesheet entry not found" });
    }

    return res.status(200).json({ message: "Timesheet entry deleted successfully" });
  } catch (error) {
    console.error("deleteEntry error:", error);
    return res.status(500).json({ message: "Failed to delete timesheet entry" });
  }
};

exports.getSummary = async (req, res) => {
  try {
    const { from, to } = req.query;
    const range = parseDateRange(from, to);

    if (!range) {
      return res.status(400).json({ message: "Valid from and to dates are required" });
    }

    const aggregated = await aggregateHierarchicalSummary({
      userIds: [req.user._id],
      range,
    });
    const currentUserSummary = aggregated.users[0];

    return res.status(200).json({
      range: { from: range.from, to: range.to },
      totalHours: aggregated.totalHours,
      clients: currentUserSummary?.clients || [],
    });
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
        username: item.username,
        department: item.department || "",
        totalHours: Number(Number(item.totalHours || 0).toFixed(2)),
      })),
    });
  } catch (error) {
    console.error("getDashboardSummary error:", error);
    return res.status(500).json({ message: "Failed to fetch dashboard summary" });
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
      "_id username department team teamGroup flow role"
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
        username: targetUser.username,
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
