// routes/cronRoutes.js
const express = require("express");
const router = express.Router();
const { dailyApprovalDigest } = require("../controllers/cronController");

// GET /api/cron/daily-approval-digest?secret=xxxx
router.get("/daily-approval-digest", dailyApprovalDigest);

module.exports = router;
