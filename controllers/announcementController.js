const Announcement = require("../models/Announcement");
const AnnouncementAction = require("../models/AnnouncementAction");
const {
  ensureAnnouncementActionIndexes,
} = require("../models/AnnouncementAction");

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
};

const normalizeString = (value) => (typeof value === "string" ? value.trim() : "");

const normalizeStringList = (value) => {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) return [];

  try {
    const parsed = JSON.parse(trimmedValue);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => normalizeString(item))
        .filter(Boolean);
    }
  } catch (error) {
    return trimmedValue
      .split(",")
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  return [];
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return fallback;
};

const ensureAdmin = (user) => {
  if (user?.role !== "admin") {
    const error = new Error("Only admins can manage announcements");
    error.statusCode = 403;
    throw error;
  }
};

const buildAnnouncementPayload = (body = {}, actor = "") => {
  const title = normalizeString(body.title);
  const message = normalizeString(body.message);
  const type = normalizeString(body.type) || "info";
  const status = normalizeString(body.status) || "draft";
  const displayMode = normalizeString(body.displayMode) || "popup";
  const priority = Number.isFinite(Number(body.priority))
    ? Number(body.priority)
    : 0;
  const audience = body.audience || {};
  const pages = normalizeStringList(body.pages);
  const startAt = body.startAt ? new Date(body.startAt) : null;
  const endAt = body.endAt ? new Date(body.endAt) : null;
  const cta = body.cta || {};

  if (!title) {
    const error = new Error("Title is required");
    error.statusCode = 400;
    throw error;
  }

  if (!message) {
    const error = new Error("Message is required");
    error.statusCode = 400;
    throw error;
  }

  if (startAt && Number.isNaN(startAt.getTime())) {
    const error = new Error("startAt must be a valid date");
    error.statusCode = 400;
    throw error;
  }

  if (endAt && Number.isNaN(endAt.getTime())) {
    const error = new Error("endAt must be a valid date");
    error.statusCode = 400;
    throw error;
  }

  if (startAt && endAt && endAt < startAt) {
    const error = new Error("endAt must be greater than or equal to startAt");
    error.statusCode = 400;
    throw error;
  }

  return {
    title,
    message,
    type,
    status,
    priority,
    displayMode,
    audience: {
      showToAll: parseBoolean(audience.showToAll, true),
      roles: normalizeStringList(audience.roles),
      departments: normalizeStringList(audience.departments),
      userIds: normalizeStringList(audience.userIds),
    },
    pages,
    startAt,
    endAt,
    requiresAcknowledgement: parseBoolean(body.requiresAcknowledgement, false),
    dismissible: parseBoolean(body.dismissible, true),
    showOncePerUser: parseBoolean(body.showOncePerUser, false),
    cta: {
      label: normalizeString(cta.label),
      url: normalizeString(cta.url),
    },
    updatedBy: actor,
  };
};

const serializeAnnouncement = (doc) => {
  const announcement = doc.toObject ? doc.toObject() : doc;
  return announcement;
};

const isAudienceMatch = (announcement, user) => {
  const audience = announcement.audience || {};
  if (audience.showToAll) return true;

  const userId = String(user?._id || "");
  const userRole = normalizeString(user?.role);
  const userDepartment = normalizeString(user?.department);

  return (
    (audience.userIds || []).includes(userId) ||
    (userRole && (audience.roles || []).includes(userRole)) ||
    (userDepartment && (audience.departments || []).includes(userDepartment))
  );
};

const isPageMatch = (announcement, pagePath) => {
  const pages = Array.isArray(announcement.pages) ? announcement.pages : [];
  if (pages.length === 0) return true;
  if (!pagePath) return false;
  return pages.includes(pagePath);
};

const isActiveNow = (announcement, now) => {
  if (announcement.status !== "active") return false;
  if (announcement.displayMode !== "popup") return false;
  if (announcement.startAt && new Date(announcement.startAt) > now) return false;
  if (announcement.endAt && new Date(announcement.endAt) < now) return false;
  return true;
};

const upsertAnnouncementAction = async ({
  announcementId,
  announcementVersion,
  user,
  action,
  pagePath = "",
}) => {
  await ensureAnnouncementActionIndexes();

  await AnnouncementAction.findOneAndUpdate(
    {
      announcementId,
      announcementVersion,
      userId: user._id,
      action,
    },
    {
      $set: {
        username: user.username,
        pagePath: normalizeString(pagePath),
        actedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
};

exports.createAnnouncement = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const payload = buildAnnouncementPayload(req.body, req.user.username);
    payload.createdBy = req.user.username;

    const announcement = await Announcement.create(payload);

    return res.status(201).json({
      message: "Announcement created successfully",
      data: serializeAnnouncement(announcement),
    });
  } catch (error) {
    console.error("createAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getAnnouncements = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const {
      status,
      displayMode,
      search = "",
      page = DEFAULT_PAGE,
      limit = DEFAULT_LIMIT,
    } = req.query;

    const normalizedPage = parsePositiveInt(page, DEFAULT_PAGE);
    const normalizedLimit = Math.min(
      parsePositiveInt(limit, DEFAULT_LIMIT),
      MAX_LIMIT
    );
    const skip = (normalizedPage - 1) * normalizedLimit;

    const query = {};

    if (normalizeString(status)) {
      query.status = normalizeString(status);
    }

    if (normalizeString(displayMode)) {
      query.displayMode = normalizeString(displayMode);
    }

    if (normalizeString(search)) {
      query.$or = [
        { title: { $regex: search.trim(), $options: "i" } },
        { message: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const [data, total] = await Promise.all([
      Announcement.find(query)
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(normalizedLimit),
      Announcement.countDocuments(query),
    ]);

    return res.status(200).json({
      data: data.map(serializeAnnouncement),
      total,
      currentPage: normalizedPage,
      totalPages: Math.ceil(total / normalizedLimit) || 1,
    });
  } catch (error) {
    console.error("getAnnouncements error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getAnnouncementById = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    return res.status(200).json({
      data: serializeAnnouncement(announcement),
    });
  } catch (error) {
    console.error("getAnnouncementById error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.updateAnnouncement = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    const payload = buildAnnouncementPayload(req.body, req.user.username);

    Object.assign(announcement, payload);
    await announcement.save();

    return res.status(200).json({
      message: "Announcement updated successfully",
      data: serializeAnnouncement(announcement),
    });
  } catch (error) {
    console.error("updateAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.updateAnnouncementStatus = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const status = normalizeString(req.body.status);
    if (!["draft", "active", "inactive", "expired"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    announcement.status = status;
    announcement.updatedBy = req.user.username;
    await announcement.save();

    return res.status(200).json({
      message: "Announcement status updated successfully",
      data: serializeAnnouncement(announcement),
    });
  } catch (error) {
    console.error("updateAnnouncementStatus error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getActivePopupAnnouncements = async (req, res) => {
  try {
    await ensureAnnouncementActionIndexes();

    const pagePath = normalizeString(req.query.pagePath);
    const now = new Date();

    const announcements = await Announcement.find({
      status: "active",
      displayMode: "popup",
      $or: [{ startAt: null }, { startAt: { $lte: now } }],
      $and: [{ $or: [{ endAt: null }, { endAt: { $gte: now } }] }],
    }).sort({ priority: -1, createdAt: -1 });

    const matchingAnnouncements = announcements.filter(
      (announcement) =>
        isActiveNow(announcement, now) &&
        isAudienceMatch(announcement, req.user) &&
        isPageMatch(announcement, pagePath)
    );

    const announcementIds = matchingAnnouncements.map((item) => item._id);
    const actions = announcementIds.length
      ? await AnnouncementAction.find({
          announcementId: { $in: announcementIds },
          userId: req.user._id,
        })
      : [];

    const actionMap = actions.reduce((accumulator, item) => {
      const key = `${item.announcementId}:${item.announcementVersion}`;
      if (!accumulator[key]) {
        accumulator[key] = new Set();
      }
      accumulator[key].add(item.action);
      return accumulator;
    }, {});

    const visibleAnnouncements = matchingAnnouncements.filter((announcement) => {
      const actionKey = `${announcement._id}:${announcement.version || 1}`;
      const actionsForUser = actionMap[actionKey] || new Set();

      if (
        announcement.requiresAcknowledgement &&
        actionsForUser.has("acknowledged")
      ) {
        return false;
      }

      if (announcement.showOncePerUser && actionsForUser.has("viewed")) {
        return false;
      }

      if (!announcement.requiresAcknowledgement && actionsForUser.has("dismissed")) {
        return false;
      }

      return true;
    });

    await Promise.all(
      visibleAnnouncements.map((announcement) =>
        upsertAnnouncementAction({
          announcementId: announcement._id,
          announcementVersion: announcement.version || 1,
          user: req.user,
          action: "viewed",
          pagePath,
        })
      )
    );

    return res.status(200).json({
      data: visibleAnnouncements.map(serializeAnnouncement),
    });
  } catch (error) {
    console.error("getActivePopupAnnouncements error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.dismissAnnouncement = async (req, res) => {
  try {
    const pagePath = normalizeString(req.body.pagePath);
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    if (!announcement.dismissible) {
      return res.status(400).json({ message: "This announcement cannot be dismissed" });
    }

    await upsertAnnouncementAction({
      announcementId: announcement._id,
      announcementVersion: announcement.version || 1,
      user: req.user,
      action: "dismissed",
      pagePath,
    });

    return res.status(200).json({
      message: "Announcement dismissed successfully",
    });
  } catch (error) {
    console.error("dismissAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.acknowledgeAnnouncement = async (req, res) => {
  try {
    const pagePath = normalizeString(req.body.pagePath);
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    await upsertAnnouncementAction({
      announcementId: announcement._id,
      announcementVersion: announcement.version || 1,
      user: req.user,
      action: "acknowledged",
      pagePath,
    });

    return res.status(200).json({
      message: "Announcement acknowledged successfully",
    });
  } catch (error) {
    console.error("acknowledgeAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.getAnnouncementLogs = async (req, res) => {
  try {
    ensureAdmin(req.user);
    await ensureAnnouncementActionIndexes();

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    const page = parsePositiveInt(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(
      parsePositiveInt(req.query.limit, DEFAULT_LIMIT),
      MAX_LIMIT
    );
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      AnnouncementAction.find({ announcementId: req.params.id })
        .sort({ actedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "firstName lastName nickname username role department"),
      AnnouncementAction.countDocuments({ announcementId: req.params.id }),
    ]);

    return res.status(200).json({
      data: data.map((item) => ({
        _id: item._id,
        announcementId: item.announcementId,
        userId: item.userId?._id || item.userId,
        username: item.username,
        firstName: item.userId?.firstName || "",
        lastName: item.userId?.lastName || "",
        nickname: item.userId?.nickname || "",
        role: item.userId?.role || "",
        department: item.userId?.department || "",
        action: item.action,
        announcementVersion: item.announcementVersion,
        pagePath: item.pagePath || "",
        actedAt: item.actedAt,
      })),
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("getAnnouncementLogs error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.republishAnnouncement = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    announcement.version = Number(announcement.version || 1) + 1;
    announcement.publishedAt = new Date();
    announcement.updatedBy = req.user.username;
    if (announcement.status === "draft") {
      announcement.status = "active";
    }

    await announcement.save();

    return res.status(200).json({
      message: "Announcement republished successfully",
      data: serializeAnnouncement(announcement),
    });
  } catch (error) {
    console.error("republishAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    ensureAdmin(req.user);

    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) {
      return res.status(404).json({ message: "Announcement not found" });
    }

    await AnnouncementAction.deleteMany({ announcementId: announcement._id });
    await Announcement.deleteOne({ _id: announcement._id });

    return res.status(200).json({
      message: "Announcement deleted successfully",
    });
  } catch (error) {
    console.error("deleteAnnouncement error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};
