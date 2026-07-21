const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const announcementController = require("../controllers/announcementController");

router.post("/", authMiddleware, announcementController.createAnnouncement);
router.get("/", authMiddleware, announcementController.getAnnouncements);
router.get(
  "/active-popup",
  authMiddleware,
  announcementController.getActivePopupAnnouncements
);
router.get("/:id/logs", authMiddleware, announcementController.getAnnouncementLogs);
router.get("/:id", authMiddleware, announcementController.getAnnouncementById);
router.put("/:id", authMiddleware, announcementController.updateAnnouncement);
router.patch(
  "/:id/status",
  authMiddleware,
  announcementController.updateAnnouncementStatus
);
router.post(
  "/:id/republish",
  authMiddleware,
  announcementController.republishAnnouncement
);
router.post(
  "/:id/dismiss",
  authMiddleware,
  announcementController.dismissAnnouncement
);
router.post(
  "/:id/acknowledge",
  authMiddleware,
  announcementController.acknowledgeAnnouncement
);
router.delete("/:id", authMiddleware, announcementController.deleteAnnouncement);

module.exports = router;
