// approvalRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const approvalController = require('../controllers/approvalController');

// เส้นทางสำหรับ Approval Hierarchy
router.post('/', authMiddleware, approvalController.createApprovalHierarchy);
router.get('/:id', authMiddleware, approvalController.getApprovalHierarchy);
router.patch('/:id', authMiddleware, approvalController.updateApprovalStatus);
router.patch('/:id/approvers', authMiddleware, approvalController.updateApproverInLevel);
router.get('/:id/status', authMiddleware, approvalController.getApprovalStatus);
router.patch("/:id/reset",authMiddleware, approvalController.resetApprovalHierarchy);

module.exports = router;

