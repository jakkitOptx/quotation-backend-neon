const express = require("express");
const router = express.Router();
const teamController = require("../controllers/teamController");

// ดึงรายชื่อทีมทั้งหมด
router.get("/", teamController.getAllTeams);

// สร้างทีมใหม่
router.post("/", teamController.createTeam);

// อัปเดตชื่อทีม
router.patch("/:id", teamController.updateTeam);

module.exports = router;
