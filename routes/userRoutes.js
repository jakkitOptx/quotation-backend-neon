// userRoutes.js
const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");

// ✅ ดึงรายชื่อผู้ใช้ทั้งหมด
router.get("/", userController.getAllUsers);

// ✅ ดึงข้อมูลผู้ใช้รายบุคคล
router.get("/:id", userController.getUserById);

// ✅ อัปเดตข้อมูลส่วนตัวของผู้ใช้
router.patch("/:id", userController.updateUserProfile);

module.exports = router;
