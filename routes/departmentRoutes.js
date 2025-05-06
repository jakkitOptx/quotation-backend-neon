const express = require("express");
const router = express.Router();
const controller = require("../controllers/departmentController");

router.get("/", controller.getAllDepartments); // 🔍 GET ทั้งหมด
router.post("/", controller.createDepartment); // ➕ สร้างใหม่
router.patch("/:id", controller.updateDepartment); // ✏️ แก้ไข

module.exports = router;
