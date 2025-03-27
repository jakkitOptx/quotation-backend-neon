// authRoutes.js
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// เส้นทางสำหรับลงทะเบียน
router.post('/register', authController.register);

// เส้นทางสำหรับเข้าสู่ระบบ
router.post('/login', authController.login);

// 🔹 เส้นทางสำหรับขอรีเซ็ตรหัสผ่าน
router.post('/request-reset', authController.requestPasswordReset);

// 🔹 เส้นทางสำหรับรีเซ็ตรหัสผ่าน
router.post('/reset-password', authController.resetPassword);

module.exports = router;

