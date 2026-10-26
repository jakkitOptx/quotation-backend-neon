const mongoose = require("mongoose");
const Notification = require("../models/Notification");

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const NOTIFICATION_MODULES = ["timesheet"];

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

// Older quotation notifications may keep the original casing of the username.
const buildRecipientFilter = (user) => {
  const username = String(user?.username || "").trim();
  return { user: { $in: [...new Set([username, username.toLowerCase()])] } };
};

const buildScopeFilter = (req) => {
  const filter = buildRecipientFilter(req.user);
  const module = String(req.query?.module || "").trim().toLowerCase();
  if (module) {
    if (!NOTIFICATION_MODULES.includes(module)) {
      return { error: "Invalid notification module" };
    }
    filter.module = module;
  }

  return { filter };
};

const buildNotificationResponse = (notification) => ({
  _id: notification._id,
  title: notification.title || "",
  message: notification.message,
  link: notification.link || null,
  type: notification.type,
  module: notification.module || null,
  event: notification.event || null,
  entityId: notification.entityId || null,
  isRead: Boolean(notification.isRead),
  readAt: notification.readAt || null,
  createdBy: notification.createdBy,
  createdAt: notification.createdAt,
});

exports.getMyNotifications = async (req, res) => {
  try {
    const { filter, error } = buildScopeFilter(req);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const page = parsePositiveInt(req.query?.page, 1);
    const limit = Math.min(
      parsePositiveInt(req.query?.limit, DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE
    );
    const listFilter =
      String(req.query?.unreadOnly || "").toLowerCase() === "true"
        ? { ...filter, isRead: false }
        : filter;

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(listFilter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(listFilter),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);

    return res.status(200).json({
      data: notifications.map(buildNotificationResponse),
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("getMyNotifications error:", error);
    return res.status(500).json({ message: "Failed to fetch notifications" });
  }
};

exports.getMyUnreadCount = async (req, res) => {
  try {
    const { filter, error } = buildScopeFilter(req);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const unreadCount = await Notification.countDocuments({
      ...filter,
      isRead: false,
    });

    return res.status(200).json({ data: { unreadCount } });
  } catch (error) {
    console.error("getMyUnreadCount error:", error);
    return res.status(500).json({ message: "Failed to fetch unread notification count" });
  }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }

    // Recipient is part of the filter, so another user's id behaves as not found.
    const notification = await Notification.findOneAndUpdate(
      { _id: id, ...buildRecipientFilter(req.user) },
      { $set: { isRead: true, readAt: new Date() } },
      { new: true }
    ).lean();
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }

    return res.status(200).json({
      message: "Notification marked as read",
      data: buildNotificationResponse(notification),
    });
  } catch (error) {
    console.error("markNotificationRead error:", error);
    return res.status(500).json({ message: "Failed to mark notification as read" });
  }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const { filter, error } = buildScopeFilter(req);
    if (error) {
      return res.status(400).json({ message: error });
    }

    const result = await Notification.updateMany(
      { ...filter, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );

    return res.status(200).json({
      message: "Notifications marked as read",
      data: { updatedCount: result.modifiedCount || 0 },
    });
  } catch (error) {
    console.error("markAllNotificationsRead error:", error);
    return res.status(500).json({ message: "Failed to mark notifications as read" });
  }
};
