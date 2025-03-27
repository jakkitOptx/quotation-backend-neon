// driveRoutes.js
const express = require('express');
const multer = require('multer');
const router = express.Router();
const { uploadFileToDrive } = require('../controllers/googleDriveController');

// ใช้ Multer สำหรับจัดเก็บไฟล์ในหน่วยความจำ
const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post('/upload', upload.single('file'), uploadFileToDrive);

module.exports = router;
