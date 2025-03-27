// controllers/approvalTemplateController.js
const ApprovalTemplate = require("../models/ApprovalTemplate");

// Create Approval Template
exports.createApprovalTemplate = async (req, res) => {
  try {
    const { templateId, createdBy, approvalHierarchy } = req.body;

    const newTemplate = new ApprovalTemplate({
      templateId,
      createdBy,
      approvalHierarchy,
    });

    const savedTemplate = await newTemplate.save();

    res
      .status(201)
      .json({ message: "Approval template created successfully", template: savedTemplate });
  } catch (error) {
    console.error("Error creating approval template:", error);
    res
      .status(500)
      .json({ message: "Failed to create approval template", error });
  }
};
  

// Update Approval Template
const mongoose = require("mongoose");

exports.updateApprovalTemplate = async (req, res) => {
  try {
    const { id } = req.params; // ใช้ _id จาก URL path
    const { templateId, approvalHierarchy } = req.body;

    // อัปเดต Template ตาม `_id`
    const updatedTemplate = await ApprovalTemplate.findByIdAndUpdate(
      id, // ใช้ _id ในการค้นหา
      { templateId, approvalHierarchy, updatedAt: Date.now() },
      { new: true } // Return ข้อมูลที่อัปเดตแล้ว
    );

    if (!updatedTemplate) {
      return res.status(404).json({ message: "Approval template not found" });
    }

    res
      .status(200)
      .json({
        message: "Approval template updated successfully",
        template: updatedTemplate,
      });
  } catch (error) {
    console.error("Error updating approval template:", error);
    res
      .status(500)
      .json({ message: "Failed to update approval template", error });
  }
};


// Delete Approval Template
exports.deleteApprovalTemplate = async (req, res) => {
  try {
    const { id } = req.params;

    const deletedTemplate = await ApprovalTemplate.findByIdAndDelete(id);

    if (!deletedTemplate) {
      return res.status(404).json({ message: "Approval template not found" });
    }

    res.status(200).json({ message: "Approval template deleted successfully" });
  } catch (error) {
    console.error("Error deleting approval template:", error);
    res.status(500).json({ message: "Failed to delete approval template", error });
  }
};

// ดึงข้อมูล Approval Templates ทั้งหมด
exports.getAllApprovalTemplates = async (req, res) => {
  try {
    const templates = await ApprovalTemplate.find();
    res.status(200).json(templates);
  } catch (error) {
    console.error("Error fetching approval templates:", error);
    res.status(500).json({ message: "Failed to fetch approval templates", error });
  }
};

// ดึงข้อมูล Approval Template ด้วย ID
exports.getApprovalTemplateById = async (req, res) => {
  try {
    const { id } = req.params;

    const template = await ApprovalTemplate.findById(id);

    if (!template) {
      return res.status(404).json({ message: "Approval template not found" });
    }

    res.status(200).json(template);
  } catch (error) {
    console.error("Error fetching approval template:", error);
    res.status(500).json({ message: "Failed to fetch approval template", error });
  }
};
