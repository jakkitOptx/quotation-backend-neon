// quotationRoutes.js
const express = require("express");
const router = express.Router();
const Quotation = require("../models/Quotation");
const Log = require("../models/Log"); // ✅ เพิ่ม Log model
const User = require("../models/User"); // ✅ เพิ่มสำหรับ lookup
const quotationController = require("../controllers/quotationController");
const _ = require("lodash");
const authMiddleware = require("../middlewares/authMiddleware"); // ✅ อย่าลืมใช้

// ✅ ฟังก์ชันปัดเศษให้เป็นทศนิยม 2 ตำแหน่ง
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// ✅ สร้างใบเสนอราคา พร้อม `clientId` และตรวจสอบ runNumber ที่หายไป
router.post("/", quotationController.createQuotation);

// ✅ ดึงใบเสนอราคาทั้งหมด พร้อม query year + email → ให้ controller จัดการ filter
router.get("/", quotationController.getQuotations);

// ✅ สรุปยอด total/pending/approved ในคำขอเดียว (ใช้ controller)
router.get("/summary", quotationController.getQuotationsSummary);

// ✅ ดึงใบเสนอราคาแบบแบ่งหน้า ต้องอยู่ก่อน "/:id"
router.get("/paginated", quotationController.getQuotationsWithPagination);

// ✅ อัปเดตใบเสนอราคา
router.patch("/:id", authMiddleware, async (req, res) => {
  const {
    title,
    client,
    clientId,
    salePerson,
    documentDate,
    productName,
    projectName,
    period,
    startDate,
    endDate,
    createBy,
    proposedBy,
    items,
    discount = 0,
    fee = 0,
    remark = "",
    CreditTerm = 0,
    type,
    isDetailedForm,
    isSpecialForm,
    numberOfSpecialPages,
    approvalStatus 
  } = req.body;

  try {
    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items must not be empty" });
    }

    if (!clientId) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    if (!type || type.trim() === "") {
      return res.status(400).json({ message: "Type is required" });
    }

    // ✅ ค้นหา Quotation ปัจจุบัน
    const existingQuotation = await Quotation.findById(req.params.id);
    if (!existingQuotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    // ✅ ถ้า type เปลี่ยนไป ให้ตรวจสอบ runNumber ใหม่ และกำหนดเป็นเลข 3 หลัก
    let runNumber = existingQuotation.runNumber;
    if (type !== existingQuotation.type) {
      const latestQuotation = await Quotation.findOne({ type }).sort({
        runNumber: -1,
      });
      runNumber = latestQuotation
        ? String(Number(latestQuotation.runNumber) + 1).padStart(3, "0")
        : "001";
    }

    // ✅ คำนวณตัวเลข
    let totalBeforeFee = 0;
    const processedItems = items.map((item) => {
      const unit = Number(item.unit) || 0;
      const unitPrice = roundUp(parseFloat(item.unitPrice) || 0);
      const amount = roundUp(unit * unitPrice);
      totalBeforeFee += amount;
      return { ...item, unitPrice, amount };
    });
    // แก้สูตร
    const calFee = roundUp(fee); // เพราะค่าที่ได้มาคือจำนวนเงิน fee ตรง ๆ แล้ว
    const total = roundUp(totalBeforeFee + calFee);
    const amountBeforeTax = roundUp(total - discount);
    const vat = roundUp(amountBeforeTax * 0.07);
    const netAmount = roundUp(amountBeforeTax + vat);

    // ✅ อัปเดต Quotation
    const updatedQuotation = await Quotation.findByIdAndUpdate(
      req.params.id,
      {
        title,
        client,
        clientId,
        salePerson,
        documentDate,
        productName,
        projectName,
        period,
        startDate,
        endDate,
        createBy,
        proposedBy,
        discount: roundUp(discount),
        fee: roundUp(fee),
        calFee,
        amount: totalBeforeFee,
        totalBeforeFee,
        total,
        amountBeforeTax,
        vat,
        netAmount,
        remark,
        CreditTerm,
        type,
        runNumber,
        items: processedItems,
        isDetailedForm,
        isSpecialForm,
        numberOfSpecialPages,
        approvalStatus
      },
      { new: true }
    );

    if (!updatedQuotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }
    // ✅ เพิ่ม Log เมื่อแก้ไข Quotation
    const user = await User.findById(req.userId);
    const performedBy = user?.username || "unknown";
    const docYear = new Date(documentDate).getFullYear();
    const runFormatted = runNumber.padStart(3, "0");
    const companyPrefix = performedBy.includes("@optx") ? "OPTX" : "NW-QT";
    const qtNumber = `${companyPrefix}(${type})-${docYear}-${runFormatted}`;

    await Log.create({
      quotationId: updatedQuotation._id,
      action: "edit",
      performedBy,
      description: `Edited quotation ${qtNumber}`,
    });

    res.status(200).json(updatedQuotation);
  } catch (error) {
    console.error("Error updating quotation:", error);
    res.status(400).json({ message: error.message });
  }
});

// ลบใบเสนอราคา
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    const deletedQuotation = await Quotation.findByIdAndDelete(req.params.id);
    if (!deletedQuotation)
      return res.status(404).json({ message: "Quotation not found" });

    // ✅ ดึงผู้ใช้ที่ลบจาก token
    const user = await User.findById(req.userId);
    const performedBy = user?.username || "unknown";

    // ✅ จัดรูปแบบเลขใบเสนอราคา
    const docYear = new Date(deletedQuotation.documentDate).getFullYear();
    const runFormatted = deletedQuotation.runNumber?.padStart(3, "0") || "???";
    const companyPrefix = performedBy.includes("@optx") ? "OPTX" : "NW-QT";
    const qtNumber = `${companyPrefix}(${deletedQuotation.type})-${docYear}-${runFormatted}`;

    // ✅ สร้าง Log การลบ
    await Log.create({
      quotationId: deletedQuotation._id,
      action: "delete",
      performedBy,
      description: `Deleted quotation ${qtNumber}`,
    });

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting quotation:", error.message);
    res.status(500).json({ message: error.message });
  }
});

// ค้นหาใบเสนอราคา
router.get("/search", async (req, res) => {
  const { title, status } = req.query;
  try {
    const query = {};

    if (title) {
      query.title = { $regex: title, $options: "i" };
    }

    if (status) {
      query.approvalStatus = status;
    }

    const quotations = await Quotation.find(query);
    res.status(200).json(quotations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ดึง qt by email สำหรับแสดงหน้าจอเร็ว ๆ (แค่ 10–20 รายการแรก)
router.get(
  "/by-email/:email/paginated",
  quotationController.getQuotationsByEmailPaginated
);

// ดึง qt by email
router.get("/by-email/:email", quotationController.getQuotationsByEmail);

// 🔹 เพิ่ม API ดึงใบ Quotation ที่ต้อง Approve ตาม Email
router.get(
  "/approval-by-email/:email",
  quotationController.getApprovalQuotationsByEmail
);
// เปลี่ยนสถานะอนุมัติ (Approve/Reject)
router.patch("/:id/approve", async (req, res) => {
  const { status, approver } = req.body;
  console.log("Request Params:", req.params);
  console.log("Request Body:", req.body);

  try {
    const quotation = await Quotation.findById(req.params.id);
    if (!quotation) {
      console.log("Quotation not found for ID:", req.params.id);
      return res.status(404).json({ message: "Quotation not found" });
    }

    quotation.approvalStatus = status;
    quotation.approvedBy = approver;
    await quotation.save();

    res.status(200).json(quotation);
  } catch (error) {
    console.error("Error approving quotation:", error.message);
    res.status(400).json({ message: error.message });
  }
});

router.patch("/:id/cancel", async (req, res) => {
  const { cancelDate, reason, canceledBy } = req.body;

  try {
    const quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (quotation.approvalStatus !== "Approved") {
      return res
        .status(400)
        .json({ message: "Only approved quotations can be canceled" });
    }

    // อัปเดตข้อมูลการยกเลิก
    quotation.cancelDate = cancelDate || new Date();
    quotation.reason = reason;
    quotation.canceledBy = canceledBy;
    quotation.approvalStatus = "Canceled";

    await quotation.save();

    res.status(200).json(quotation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// อัปเดตเหตุผลของ Quotation
router.patch("/:id/reason", async (req, res) => {
  const { reason } = req.body;

  try {
    // ค้นหาใบ Quotation ตาม ID
    const quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    // ✅ อัปเดตเหตุผล
    quotation.reason = reason;
    await quotation.save();

    res.status(200).json({ message: "Reason updated successfully", quotation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ API สำหรับ Reset Quotation ที่ถูก Canceled
router.patch("/:id/reset", authMiddleware, quotationController.resetQuotation);

// ✅ Duplicate Quotation
router.post("/:id/duplicate", quotationController.duplicateQuotation);

// ✅ อัปเดต Flow ของใบเสนอราคาเดิมให้เป็น Flow ปัจจุบัน
router.patch("/:id/update-approval-flow", quotationController.updateApprovalFlow);
// ✅ ดึงใบเสนอราคาเดี่ยว พร้อม field department
router.get("/:id", async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser department amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus cancelDate reason canceledBy remark CreditTerm isDetailedForm isSpecialForm numberOfSpecialPages"
      )

      .populate({
        path: "approvalHierarchy",
        select: "quotationId approvalHierarchy",
        populate: {
          path: "approvalHierarchy",
          select: "level approver status",
        },
      })
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      ); // ✅ เพิ่มการ populate clientId

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    res.status(200).json(quotation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
module.exports = router;
