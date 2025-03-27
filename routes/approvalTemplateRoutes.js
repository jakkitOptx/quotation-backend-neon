// routes/approvalTemplateRoutes.js
const express = require("express");
const {
  createApprovalTemplate,
  updateApprovalTemplate,
  deleteApprovalTemplate,
  getAllApprovalTemplates,
  getApprovalTemplateById,
} = require("../controllers/approvalTemplateController");

const router = express.Router();

// Create Approval Template
router.post("/", createApprovalTemplate);

// Update Approval Template by ID
router.put("/:id", updateApprovalTemplate);

// Delete Approval Template by ID
router.delete("/:id", deleteApprovalTemplate);

// Get All Approval Templates
router.get("/", getAllApprovalTemplates);

// Get Approval Template by ID
router.get("/:id", getApprovalTemplateById);

module.exports = router;
