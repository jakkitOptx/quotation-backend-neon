// routes/reportRoutes.js
const express = require("express");
const { getDepartmentSpending } = require("../controllers/reportController");
const authMiddleware = require("../middlewares/authMiddleware"); // ✅ ใช้ชื่อเดียวกับที่ export

const router = express.Router();

// ✅ สรุปยอดใช้จ่ายรายแผนก
router.get("/department-spending", authMiddleware, getDepartmentSpending);

module.exports = router;
