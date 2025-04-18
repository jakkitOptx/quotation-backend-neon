// quotationController.js
const _ = require("lodash"); // ✅ Import lodash
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");

// ✅ ฟังก์ชันปัดเศษแบบพิเศษ (ปัดขึ้นหากทศนิยมหลักที่ 3 >= 5)
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// ✅ สร้างใบ Quotation ใหม่
exports.createQuotation = async (req, res) => {
  const { title, amount, allocation = null, description = null, type = "M" , isDetailedForm = false} = req.body;

  try {
    if (!title || amount == null) {
      return res.status(400).json({ message: "Title and amount are required" });
    }

    // ✅ ปัดเศษ amount ตามกฎที่กำหนด
    const roundedAmount = roundUp(amount);

    // ✅ ตรวจสอบเลขรันล่าสุดของ type
    const lastQuotation = await Quotation.findOne({ type }).sort({ runNumber: -1 });
    const newRunNumber = lastQuotation
      ? String(Number(lastQuotation.runNumber) + 1).padStart(3, "0")
      : "001";

    // ✅ สร้าง Quotation ใหม่
    const quotation = new Quotation({
      title,
      amount: roundedAmount,
      allocation,
      description,
      runNumber: newRunNumber,
      type,
    });

    await quotation.save();

    res.status(201).json(quotation);
  } catch (error) {
    console.error("Error creating quotation:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// ✅ ดึง Quotation ตาม Email ของ createdByUser
exports.getQuotationsByEmail = async (req, res) => {
  const { email } = req.params;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const quotations = await Quotation.find({ createdByUser: email })
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus cancelDate reason canceledBy remark CreditTerm isDetailedForm"
      )
      .populate("clientId", "customerName address taxIdentificationNumber contactPhoneNumber"); // ✅ เพิ่มการดึงข้อมูลลูกค้า

    // ✅ ปัดเศษค่าตัวเลขให้ถูกต้องก่อนส่งกลับ
    const roundedQuotations = quotations.map((qt) => ({
      ...qt.toObject(),
      amount: roundUp(qt.amount),
      discount: roundUp(qt.discount),
      fee: roundUp(qt.fee),
      calFee: roundUp(qt.calFee),
      totalBeforeFee: roundUp(qt.totalBeforeFee),
      total: roundUp(qt.total),
      amountBeforeTax: roundUp(qt.amountBeforeTax),
      vat: roundUp(qt.vat),
      netAmount: roundUp(qt.netAmount),
    }));

    res.status(200).json(roundedQuotations);
  } catch (error) {
    console.error("Error fetching quotations by email:", error);
    res.status(500).json({ message: error.message });
  }
};

// ✅ ดึงใบเสนอราคาแบบแบ่งหน้า พร้อม client
exports.getQuotationsWithPagination = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [quotations, total] = await Promise.all([
      Quotation.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("clientId", "customerName address taxIdentificationNumber contactPhoneNumber")
        .populate({
          path: "approvalHierarchy",
          select: "quotationId approvalHierarchy",
          populate: {
            path: "approvalHierarchy",
            select: "level approver status",
          },
        }),
      Quotation.countDocuments()
    ]);

    res.status(200).json({
      data: quotations,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching quotations with pagination:", error);
    res.status(500).json({ message: error.message });
  }
};


// ✅ ดึง Quotation ที่ต้อง Approve ตาม Email และ return reason ด้วย
exports.getApprovalQuotationsByEmail = async (req, res) => {
  const { email } = req.params;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const quotations = await Quotation.find()
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus reason remark CreditTerm approvalHierarchy"
      )
      .populate("clientId", "customerName address taxIdentificationNumber contactPhoneNumber") // ✅ เพิ่มข้อมูลลูกค้า
      .populate({
        path: "approvalHierarchy",
        select: "quotationId approvalHierarchy",
        populate: {
          path: "approvalHierarchy",
          select: "level approver status",
        },
      });

    const filteredQuotations = quotations.filter((qt) => {
      if (!qt.approvalHierarchy || qt.approvalHierarchy.length === 0) return false;
      const hierarchy = qt.approvalHierarchy[0]?.approvalHierarchy || [];
      return hierarchy.some((level) => level.approver === email);
    });

    // ✅ ปัดเศษค่าตัวเลขก่อนส่งออก
    const roundedQuotations = filteredQuotations.map((qt) => ({
      ...qt.toObject(),
      amount: roundUp(qt.amount),
      discount: roundUp(qt.discount),
      fee: roundUp(qt.fee),
      calFee: roundUp(qt.calFee),
      totalBeforeFee: roundUp(qt.totalBeforeFee),
      total: roundUp(qt.total),
      amountBeforeTax: roundUp(qt.amountBeforeTax),
      vat: roundUp(qt.vat),
      netAmount: roundUp(qt.netAmount),
    }));

    res.status(200).json(roundedQuotations);
  } catch (error) {
    console.error("Error fetching approval quotations:", error.message);
    res.status(500).json({ message: error.message });
  }
};

// ✅ อัปเดตเหตุผลของใบ Quotation
exports.updateQuotationReason = async (req, res) => {
  const { reason } = req.body;

  try {
    const quotation = await Quotation.findById(req.params.id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    quotation.reason = reason;
    await quotation.save();

    res.status(200).json({ message: "Reason updated successfully", quotation });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ Reset Quotation เมื่อถูก Canceled หรือ Approved
exports.resetQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const quotation = await Quotation.findById(id);

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (!["Canceled", "Approved"].includes(quotation.approvalStatus)) {
      return res.status(400).json({
        message: "Quotation must be in Canceled or Approved status to reset",
      });
    }

    const approval = await Approval.findOne({ quotationId: id });

    if (!approval) {
      return res.status(404).json({ message: "Approval flow not found for this quotation" });
    }

    approval.approvalHierarchy = approval.approvalHierarchy.map((level) => ({
      ...level,
      status: "Pending",
      approvedAt: null,
    }));

    await approval.save();
    quotation.approvalStatus = "Pending";
    await quotation.save();

    res.status(200).json({
      message: "Quotation reset successfully",
      approvalStatus: quotation.approvalStatus,
      approvalHierarchy: approval.approvalHierarchy,
    });
  } catch (error) {
    console.error("Error resetting quotation:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
