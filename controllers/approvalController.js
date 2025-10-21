// controllers/approvalController.js
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Log = require("../models/Log");
const Notification = require("../models/Notification");

// ✅ สร้าง Approval Hierarchy
exports.createApprovalHierarchy = async (req, res) => {
  const { quotationId, approvalHierarchy } = req.body;

  if (!quotationId || !approvalHierarchy) {
    return res
      .status(400)
      .json({ message: "Quotation ID and approval hierarchy are required" });
  }

  try {
    const quotation = await Quotation.findById(quotationId);
    if (!quotation) return res.status(404).json({ message: "Quotation not found" });

    if (!quotation.createdByUser) {
      return res.status(400).json({
        message: "The Quotation does not have a createdByUser field defined.",
      });
    }

    const approval = new Approval({ quotationId, approvalHierarchy });
    await approval.save();

    quotation.approvalHierarchy.push(approval._id);
    await quotation.save();

    res.status(201).json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ ดึงโครงสร้าง Approval Hierarchy
exports.getApprovalHierarchy = async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id).populate("quotationId");
    if (!approval) return res.status(404).json({ message: "Approval not found" });
    res.status(200).json(approval);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ อัปเดตสถานะ Approve ใน Level (ไม่ได้ใช้บน web)
exports.updateApprovalStatus = async (req, res) => {
  const { level, status } = req.body;

  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(401).json({ message: "User not found" });

    if (user.level < level) {
      return res.status(403).json({ message: "Permission denied: Insufficient level" });
    }

    const approval = await Approval.findById(req.params.id);
    if (!approval) return res.status(404).json({ message: "Approval not found" });

    const hierarchy = approval.approvalHierarchy.find((item) => item.level === level);
    if (!hierarchy)
      return res.status(404).json({ message: `Approval level ${level} not found` });

    hierarchy.status = status;
    hierarchy.approvedAt = new Date();

    const allApproved = approval.approvalHierarchy.every(
      (item) => item.status === "Approved"
    );

    if (allApproved) {
      const quotation = await Quotation.findById(approval.quotationId);
      if (!quotation) return res.status(404).json({ message: "Quotation not found" });
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

// ✅ อัปเดต Approver ใน Level หรืออัปเดต Status โดยใช้ Level และ Email
exports.updateApproverInLevel = async (req, res) => {
  const { level, approver, status } = req.body;

  if (!level || !approver || !status) {
    return res.status(400).json({
      message: "Level, approver, and status are required",
    });
  }

  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval)
      return res.status(404).json({ message: "Approval not found" });

    const quotation = await Quotation.findById(approval.quotationId);
    if (!quotation)
      return res.status(404).json({ message: "Quotation not found" });

    const hierarchy = approval.approvalHierarchy.find(
      (item) => item.level === level && item.approver === approver
    );
    if (hierarchy) {
      hierarchy.status = status;
      hierarchy.approvedAt = new Date();
    }

    const companyPrefix = approver.includes("@optx") ? "OPTX" : "NW-QT";
    const docYear = new Date(quotation.documentDate).getFullYear();
    const runFormatted = quotation.runNumber?.padStart(3, "0") || "???";
    const qtNumber = `${companyPrefix}(${quotation.type})-${docYear}-${runFormatted}`;

    const io = global._io;
    const now = new Date(); // ✅ ใช้ timestamp เดียวกันในทุก action

    // ✅ CANCELED
    if (status === "Canceled" && level >= 2) {
      quotation.approvalStatus = "Canceled";
      quotation.cancelDate = now;
      quotation.canceledBy = approver;

      await Log.create({
        quotationId: quotation._id,
        action: "cancel",
        performedBy: approver,
        description: `Canceled ${qtNumber}`,
      });

      await Notification.create({
        user: quotation.createdByUser,
        message: `เอกสาร ${qtNumber} ถูกยกเลิกโดย ${approver}`,
        createdBy: approver,
        type: "approval",
        createdAt: now,
      });

      io?.to(quotation.createdByUser.toLowerCase().trim()).emit("notification", {
        title: "❌ ใบเสนอราคาถูกยกเลิก",
        message: `เอกสาร ${qtNumber} ถูกยกเลิกโดย ${approver}`,
        createdAt: now,
      });

    // ✅ REJECTED
    } else if (status === "Rejected" && level >= 2) {
      quotation.approvalStatus = "Rejected";

      await Log.create({
        quotationId: quotation._id,
        action: "reject",
        performedBy: approver,
        description: `${qtNumber} rejected by ${approver}`,
      });

      await Notification.create({
        user: quotation.createdByUser,
        message: `เอกสาร ${qtNumber} ถูก Reject โดย ${approver}`,
        createdBy: approver,
        type: "approval",
        createdAt: now,
      });

      io?.to(quotation.createdByUser.toLowerCase().trim()).emit("notification", {
        title: "🚫 ใบเสนอราคาถูก Reject",
        message: `เอกสาร ${qtNumber} ถูก Reject โดย ${approver}`,
        createdAt: now,
      });

    // ✅ APPROVED
    } else if (status === "Approved") {
      const allApproved = approval.approvalHierarchy.every(
        (item) => item.status === "Approved"
      );

      // 🔹 กรณีอนุมัติครบทุกลำดับ
      if (allApproved) {
        quotation.approvalStatus = "Approved";

        await Log.create({
          quotationId: quotation._id,
          action: "approve",
          performedBy: approver,
          description: `${qtNumber} is fully approved.`,
        });

        await Notification.create({
          user: quotation.createdByUser,
          message: `เอกสาร ${qtNumber} ได้รับการอนุมัติครบทุกลำดับ ✅`,
          createdBy: approver,
          type: "approval",
          createdAt: now,
        });

        io?.to(quotation.createdByUser.toLowerCase().trim()).emit("notification", {
          title: "✅ ใบเสนอราคาอนุมัติครบทุกคนแล้ว",
          message: `เอกสาร ${qtNumber} ได้รับการอนุมัติครบทุกลำดับ`,
          createdAt: now,
        });

      // 🔹 กรณีอนุมัติบางลำดับ (ยังไม่ครบ)
      } else {
        await Log.create({
          quotationId: quotation._id,
          action: "approve",
          performedBy: approver,
          description: `${qtNumber} approved by ${approver}`,
        });

        // แจ้งผู้อนุมัติลำดับถัดไป
        const nextLevel = approval.approvalHierarchy.find(
          (lvl) => lvl.status === "Pending"
        );
        if (nextLevel?.approver) {
          await Notification.create({
            user: nextLevel.approver,
            message: `เอกสาร ${qtNumber} รอการอนุมัติจากคุณ`,
            createdBy: approver,
            type: "approval",
            createdAt: now,
          });

          io?.to(nextLevel.approver.toLowerCase().trim()).emit("notification", {
            title: "📩 ใบเสนอราคาพร้อมรออนุมัติ",
            message: `เอกสาร ${qtNumber} รอการอนุมัติจากคุณ`,
            createdAt: now,
          });
        }

        // แจ้งผู้สร้างเอกสาร
        await Notification.create({
          user: quotation.createdByUser,
          message: `เอกสาร ${qtNumber} ได้รับการอนุมัติจาก ${approver}`,
          createdBy: approver,
          type: "approval",
          createdAt: now,
        });

        io?.to(quotation.createdByUser.toLowerCase().trim()).emit("notification", {
          title: "✅ ใบเสนอราคาของคุณได้รับการอนุมัติแล้ว",
          message: `เอกสาร ${qtNumber} ได้รับการอนุมัติจาก ${approver}`,
          createdAt: now,
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
    console.error("❌ Error updating approval:", error.message);
    res.status(500).json({ message: error.message });
  }
};


// ✅ ดึงสถานะปัจจุบัน
exports.getApprovalStatus = async (req, res) => {
  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) return res.status(404).json({ message: "Approval not found" });

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

// ✅ Reset approvalHierarchy
exports.resetApprovalHierarchy = async (req, res) => {
  const { approvalHierarchy } = req.body;

  try {
    const approval = await Approval.findById(req.params.id);
    if (!approval) return res.status(404).json({ message: "Approval not found" });

    approval.approvalHierarchy = approvalHierarchy;
    await approval.save();

    const quotation = await Quotation.findById(approval.quotationId);
    if (quotation) {
      quotation.approvalStatus = "Pending";
      await quotation.save();
    }

    res.status(200).json({
      message: "Approval flow reset successfully",
      approval,
    });
  } catch (error) {
    console.error("Error resetting approval hierarchy:", error.message);
    res.status(500).json({ message: error.message });
  }
};
