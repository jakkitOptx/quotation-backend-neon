const express = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const timesheetController = require("../controllers/timesheetController");

const router = express.Router();

router.use(authMiddleware);

router.get("/projects", timesheetController.getProjects);
router.post("/projects", timesheetController.createProject);
router.patch("/projects/:id", timesheetController.updateProject);
router.delete("/projects/:id", timesheetController.deleteProject);

router.get("/projects/:projectId/details", timesheetController.getDetails);
router.post("/projects/:projectId/details", timesheetController.createDetail);
router.patch("/details/:id", timesheetController.updateDetail);
router.delete("/details/:id", timesheetController.deleteDetail);

router.get("/entries", timesheetController.getEntries);
router.post("/entries", timesheetController.createEntry);
router.patch("/entries/:id", timesheetController.updateEntry);
router.delete("/entries/:id", timesheetController.deleteEntry);

router.get("/dashboard/users", timesheetController.getDashboardUsers);
router.get("/dashboard/summary", timesheetController.getDashboardSummary);
router.get(
  "/dashboard/users/:userId/summary",
  timesheetController.getDashboardUserSummary
);

router.get("/summary", timesheetController.getSummary);

module.exports = router;
