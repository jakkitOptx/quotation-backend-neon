const express = require("express");
const router = express.Router();
const Quotation = require("../models/Quotation");
const quotationController = require("../controllers/quotationController");
const _ = require("lodash");

// ✅ ฟังก์ชันปัดเศษให้เป็นทศนิยม 2 ตำแหน่ง
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// ✅ สร้างใบเสนอราคา พร้อม `clientId` และตรวจสอบ runNumber ที่หายไป
router.post("/", async (req, res) => {
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
    createdByUser,
    type = "M",
    items,
    discount = 0,
    fee = 0,
    remark = "",
    CreditTerm = 0,
    isDetailedForm = false,
  } = req.body;

  try {
    if (!clientId) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items must not be empty" });
    }

    if (!createdByUser) {
      return res.status(400).json({ message: "Created By User is required" });
    }

    let totalBeforeFee = 0;
    const processedItems = items.map((item, index) => {
      const unit = Number(item.unit) || 0;
      const unitPrice = roundUp(parseFloat(item.unitPrice) || 0);
      const amount = roundUp(unit * unitPrice);

      if (!item.description) {
        throw new Error(`Item at index ${index} is missing a description.`);
      }

      totalBeforeFee += amount;
      return { ...item, unitPrice, amount };
    });

    const calFee = roundUp(totalBeforeFee * (fee / 100));
    const total = roundUp(totalBeforeFee + calFee);
    const amountBeforeTax = roundUp(total - discount);
    const vat = roundUp(amountBeforeTax * 0.07);
    const netAmount = roundUp(amountBeforeTax + vat);

    // ✅ หา runNumber ที่ว่างอยู่ใน type นั้น
    const existingQuotations = await Quotation.find({ type }).select("runNumber");
    const existingRunNumbers = existingQuotations.map((q) => Number(q.runNumber));

    let newRunNumber = "001";
    for (let i = 1; i <= 999; i++) {
      if (!existingRunNumbers.includes(i)) {
        newRunNumber = String(i).padStart(3, "0");
        break;
      }
    }

    const quotation = new Quotation({
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
      createdByUser,
      allocation: null,
      description: null,
      amount: roundUp(totalBeforeFee),
      totalBeforeFee,
      total,
      discount: roundUp(discount),
      fee: roundUp(fee),
      calFee,
      amountBeforeTax,
      vat,
      netAmount,
      type,
      runNumber: newRunNumber,
      items: processedItems,
      approvalStatus: "Pending",
      remark,
      CreditTerm,
      isDetailedForm,
    });

    await quotation.save();
    res.status(201).json(quotation);
  } catch (error) {
    console.error("Error creating quotation:", error);
    res.status(400).json({ message: error.message });
  }
});


// ✅ ดึงใบเสนอราคาทั้งหมด พร้อมข้อมูล `clientId`
router.get("/", async (req, res) => {
  try {
    const quotations = await Quotation.find()
      .populate("clientId", "customerName address taxIdentificationNumber contactPhoneNumber") // ✅ ดึงข้อมูลลูกค้าครบถ้วน
      .populate({
        path: "approvalHierarchy",
        select: "quotationId approvalHierarchy",
        populate: {
          path: "approvalHierarchy",
          select: "level approver status",
        },
      });

    res.status(200).json(quotations);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ ดึงใบเสนอราคาเดี่ยว
router.get("/:id", async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .populate("clientId", "customerName address taxIdentificationNumber contactPhoneNumber") // ✅ ดึงข้อมูลลูกค้า
      .populate({
        path: "approvalHierarchy",
        select: "quotationId approvalHierarchy",
        populate: {
          path: "approvalHierarchy",
          select: "level approver status",
        },
      });

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    res.status(200).json(quotation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ อัปเดตใบเสนอราคา
router.patch("/:id", async (req, res) => {
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
      const latestQuotation = await Quotation.findOne({ type }).sort({ runNumber: -1 });
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

    const calFee = roundUp(totalBeforeFee * (fee / 100));
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
      },
      { new: true }
    );

    if (!updatedQuotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    res.status(200).json(updatedQuotation);
  } catch (error) {
    console.error("Error updating quotation:", error);
    res.status(400).json({ message: error.message });
  }
});

// ลบใบเสนอราคา
router.delete("/:id", async (req, res) => {
  try {
    const deletedQuotation = await Quotation.findByIdAndDelete(req.params.id);
    if (!deletedQuotation)
      return res.status(404).json({ message: "Quotation not found" });
    res.status(204).send();
  } catch (error) {
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

// ดึง qt by email
router.get("/by-email/:email", quotationController.getQuotationsByEmail);

// 🔹 เพิ่ม API ดึงใบ Quotation ที่ต้อง Approve ตาม Email
router.get(
  "/approval-by-email/:email",
  quotationController.getApprovalQuotationsByEmail
);

// ดึงใบเสนอราคาเดี่ยว
router.get("/:id", async (req, res) => {
  try {
    const quotation = await Quotation.findById(req.params.id)
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus cancelDate reason canceledBy remark CreditTerm isDetailedForm"
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
      ); // เพิ่มการ populate clientId

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    res.status(200).json(quotation);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

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
router.patch("/:id/reset", quotationController.resetQuotation);
module.exports = router;
