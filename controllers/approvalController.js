// approvalController.js
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Log = require("../models/Log");

// สร้าง Approval Hierarchy
exports.createApprovalHierarchy = async (req, res) => {
  const { quotationId, approvalHierarchy } = req.body;

  if (!quotationId || !approvalHierarchy) {
    return res
      .status(400)
      .json({ message: "Quotation ID and approval hierarchy are required" });
  }

  try {
    // ตรวจสอบว่ามี Quotation อยู่และมี `createdByUser`
    const quotation = await Quotation.findById(quotationId);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (!quotation.createdByUser) {
      return res.status(400).json({
        message: "The Quotation does not have a createdByUser field defined.",
      });
    }

    // สร้าง Approval
    const approval = new Approval({
      quotationId,
      approvalHierarchy,
    });
    await approval.save();

    // อัปเดต Quotation ด้วย Approval Hierarchy ID
    quotation.approvalHierarchy.push(approval._id);
    await quotation.save();

    res.status(201).json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ดึงโครงสร้าง Approval Hierarchy
exports.getApprovalHierarchy = async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id).populate(
      "quotationId"
    );
    if (!approval)
      return res.status(404).json({ message: "Approval not found" });
    res.status(200).json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// อัปเดตสถานะ Approve ใน Level **ไม่ได้ใช้ บน web**
exports.updateApprovalStatus = async (req, res) => {
  const { level, status } = req.body;

  try {
    // ตรวจสอบผู้ใช้งานที่กำลัง Approve
    const user = await User.findById(req.userId); // userId มาจาก JWT Token
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (user.level < level) {
      return res
        .status(403)
        .json({ message: "Permission denied: Insufficient level" });
    }

    // ค้นหา Approval
    const approval = await Approval.findById(req.params.id);
    if (!approval)
      return res.status(404).json({ message: "Approval not found" });

    const hierarchy = approval.approvalHierarchy.find(
      (item) => item.level === level
    );
    if (!hierarchy)
      return res
        .status(404)
        .json({ message: `Approval level ${level} not found` });

    hierarchy.status = status; // อัปเดตสถานะ
    hierarchy.approvedAt = new Date(); // บันทึก timestamp

    // ตรวจสอบว่าทุก Level อนุมัติครบหรือยัง
    const allApproved = approval.approvalHierarchy.every(
      (item) => item.status === "Approved"
    );

    if (allApproved) {
      // อัปเดต Quotation เป็น Approved
      const quotation = await Quotation.findById(approval.quotationId);
      if (!quotation) {
        return res.status(404).json({ message: "Quotation not found" });
      }

      quotation.approvalStatus = "Approved";
      await quotation.save();
    }

    await approval.save();

    res.status(200).json({
      message: `Approval status updated to ${status} for level ${level}`,
      approval,
    });
  } catch (error) {
    console.error("Error updating approval status:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// อัปเดต Approver ใน Level หรืออัปเดต Status โดยใช้ Level และ Email
exports.updateApproverInLevel = async (req, res) => {
  const { level, approver, status } = req.body;

  if (!level || !approver || !status) {
    return res.status(400).json({
      message: "Level, approver, and status are required",
    });
  }

  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      return res.status(404).json({ message: "Approval not found" });
    }

    const quotation = await Quotation.findById(approval.quotationId);
    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    // ✅ ดึงข้อมูล user จาก email
    const user = await User.findOne({ username: approver.toLowerCase().trim() });

    // ====== อัปเดตใน flow ถ้ามีอยู่ ======
    const hierarchy = approval.approvalHierarchy.find(
      (item) => item.level === level && item.approver === approver
    );
    if (hierarchy) {
      hierarchy.status = status;
      hierarchy.approvedAt = new Date();
    }

    // ✅ ตรวจ prefix ของรหัส QT
    const companyPrefix = approver.includes("@optx") ? "OPTX" : "NW-QT";
    const docYear = new Date(quotation.documentDate).getFullYear();
    const runFormatted = quotation.runNumber?.padStart(3, "0") || "???";
    const qtNumber = `${companyPrefix}(${quotation.type})-${docYear}-${runFormatted}`;

    // ====== จัดการตาม status ======
    if (status === "Canceled" && level >= 2) {
      quotation.approvalStatus = "Canceled";
      quotation.cancelDate = new Date();
      quotation.canceledBy = approver;

      await Log.create({
        quotationId: quotation._id,
        action: "cancel",
        performedBy: approver,
        description: `Canceled ${qtNumber} by ${user?.role === "admin" ? "admin override" : approver}`,
      });

    } else if (status === "Rejected" && level >= 2) {
      quotation.approvalStatus = "Rejected";

      await Log.create({
        quotationId: quotation._id,
        action: "reject",
        performedBy: approver,
        description: `${qtNumber} rejected by ${user?.role === "admin" ? "admin override" : approver}`,
      });

    } else if (status === "Approved") {
      // ✅ เช็คทุกคนใน flow อนุมัติครบหรือยัง
      const allApproved = approval.approvalHierarchy.every(
        (item) => item.status === "Approved"
      );

      if (allApproved) {
        quotation.approvalStatus = "Approved";

        await Log.create({
          quotationId: quotation._id,
          action: "approve",
          performedBy: approver,
          description: `${qtNumber} is fully approved.`,
        });
      } else {
        await Log.create({
          quotationId: quotation._id,
          action: "approve",
          performedBy: approver,
          description: `${qtNumber} approved by ${user?.role === "admin" ? "admin override" : approver}`,
        });
      }
    }

    await approval.save();
    await quotation.save();

    res.status(200).json({
      message: `Approval status updated to ${status} for ${approver} at level ${level}`,
      approval,
    });

  } catch (error) {
    console.error("Error updating approval:", error.message);
    res.status(500).json({ message: error.message });
  }
};


// ดึงสถานะปัจจุบัน **ไม่ได้ใช้ บน web**
exports.getApprovalStatus = async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval)
      return res.status(404).json({ message: "Approval not found" });

    const status = approval.approvalHierarchy.map((hierarchy) => ({
      level: hierarchy.level,
      approver: hierarchy.approver,
      status: hierarchy.status,
    }));

    res.status(200).json({ status });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Reset approvalHierarchy เมื่อมีการแก้ไข **ไม่ได้ใช้ บน web**
exports.resetApprovalHierarchy = async (req, res) => {
  const { approvalHierarchy } = req.body;

  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) {
      return res.status(404).json({ message: "Approval not found" });
    }

    // อัปเดต status ของ approvalHierarchy ทุก level เป็น "Pending"
    approval.approvalHierarchy = approvalHierarchy;
    await approval.save();

    // อัปเดต Quotation ให้กลับเป็น Pending
    const quotation = await Quotation.findById(approval.quotationId);
    if (quotation) {
      quotation.approvalStatus = "Pending";
      await quotation.save();
    }

    res
      .status(200)
      .json({ message: "Approval flow reset successfully", approval });
  } catch (error) {
    console.error("Error resetting approval hierarchy:", error.message);
    res.status(500).json({ message: error.message });
  }
};
