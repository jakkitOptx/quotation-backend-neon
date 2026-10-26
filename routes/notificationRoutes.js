const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const notificationController = require("../controllers/notificationController");

const router = express.Router();

router.use(authMiddleware);

router.get("/", notificationController.getMyNotifications);
router.get("/unread-count", notificationController.getMyUnreadCount);
router.patch("/read-all", notificationController.markAllNotificationsRead);
router.patch("/:id/read", notificationController.markNotificationRead);

module.exports = router;
