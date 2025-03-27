// approveFlowRoutes.js สร้าง flow approve
const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// Schema สำหรับ Approve Flow
const approveFlowSchema = new mongoose.Schema({
  name: { type: String, required: true }, // ชื่อ Flow เช่น "Flow 1"
  approvalHierarchy: [
    {
      level: { type: Number, required: true },
      approver: { type: String, required: true },
    },
  ],
});

// สร้าง Model
const ApproveFlow = mongoose.model("ApproveFlow", approveFlowSchema);

// 1. สร้าง Flow ใหม่
router.post("/create", async (req, res) => {
  try {
    const { name, approvalHierarchy } = req.body;

    // ตรวจสอบข้อมูล
    if (!name || !approvalHierarchy || approvalHierarchy.length === 0) {
      return res.status(400).json({ error: "Invalid data" });
    }

    // บันทึก Flow ใหม่
    const newFlow = new ApproveFlow({ name, approvalHierarchy });
    await newFlow.save();

    res.status(201).json({ message: "Approve flow created successfully", flow: newFlow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. อัปเดต Flow
router.put("/update/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, approvalHierarchy } = req.body;

    // อัปเดต Flow
    const updatedFlow = await ApproveFlow.findByIdAndUpdate(
      id,
      { name, approvalHierarchy },
      { new: true }
    );

    if (!updatedFlow) {
      return res.status(404).json({ error: "Approve flow not found" });
    }

    res.status(200).json({ message: "Approve flow updated successfully", flow: updatedFlow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. ลบ Flow
router.delete("/delete/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // ลบ Flow
    const deletedFlow = await ApproveFlow.findByIdAndDelete(id);

    if (!deletedFlow) {
      return res.status(404).json({ error: "Approve flow not found" });
    }

    res.status(200).json({ message: "Approve flow deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. ดึงข้อมูล Flow ทั้งหมด
router.get("/", async (req, res) => {
  try {
    const flows = await ApproveFlow.find();
    res.status(200).json({ flows });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. ดึงข้อมูล Flow ตาม ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const flow = await ApproveFlow.findById(id);

    if (!flow) {
      return res.status(404).json({ error: "Approve flow not found" });
    }

    res.status(200).json({ flow });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
