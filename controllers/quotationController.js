// quotationController.js
const _ = require("lodash"); // ✅ Import lodash
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");
const User = require("../models/User");


// ✅ ฟังก์ชันปัดเศษแบบพิเศษ (ปัดขึ้นหากทศนิยมหลักที่ 3 >= 5)
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// ✅ สร้างใบ Quotation ใหม่ (version ใส่ department + เงื่อนไขครบ)
exports.createQuotation = async (req, res) => {
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
    createdByUser, // ✅ ต้องมีเพื่อ lookup department
    type = "M",
    items,
    discount = 0,
    fee = 0,
    remark = "",
    CreditTerm = 0,
    isDetailedForm = false,
  } = req.body;

  try {
    // ✅ Validate parameter ที่จำเป็น
    if (!clientId) {
      return res.status(400).json({ message: "Client ID is required" });
    }

    if (!items || items.length === 0) {
      return res.status(400).json({ message: "Items must not be empty" });
    }

    if (!createdByUser) {
      return res.status(400).json({ message: "Created By User is required" });
    }

    // ✅ หา User เพื่อนำ department มาใส่ Quotation
    const user = await User.findOne({ username: createdByUser });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ คำนวณรายการ item
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

    // ✅ คำนวณ fee, total, amountBeforeTax, vat, netAmount
    const calFee = roundUp(totalBeforeFee * (fee / 100));
    const total = roundUp(totalBeforeFee + calFee);
    const amountBeforeTax = roundUp(total - discount);
    const vat = roundUp(amountBeforeTax * 0.07);
    const netAmount = roundUp(amountBeforeTax + vat);

    // ✅ หา runNumber ที่ว่างอยู่ใน type นั้น และเริ่มจากค่าใน .env
    const startRunEnvKey = `START_RUN_${type.toUpperCase()}`;
    const startRunNumber = parseInt(process.env[startRunEnvKey]) || 1;

    const existingQuotations = await Quotation.find({ type }).select(
      "runNumber"
    );
    const existingRunNumbers = existingQuotations.map((q) =>
      Number(q.runNumber)
    );

    let newRunNumber = "001";
    for (let i = startRunNumber; i <= 999; i++) {
      if (!existingRunNumbers.includes(i)) {
        newRunNumber = String(i).padStart(3, "0");
        break;
      }
    }

    // ✅ สร้าง Quotation ใหม่ (ข้อมูลครบ)
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
      department: user.department, // ✅ ใส่ department
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
};

// ✅ ดึง Quotation ตาม email พร้อมแบ่งหน้า และรองรับ query ปี
exports.getQuotationsByEmailPaginated = async (req, res) => {
  const { email } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip = (page - 1) * limit;
  const { year } = req.query;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // ✅ กำหนดช่วงวันที่ตามปี (ถ้าไม่ส่งมา → ใช้ปีปัจจุบัน)
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      createdByUser: email,
      documentDate: { $gte: start, $lt: end },
    };

    const total = await Quotation.countDocuments(query);

    const quotations = await Quotation.find(query)
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus cancelDate reason canceledBy remark CreditTerm isDetailedForm"
      )
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

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

    res.status(200).json({
      data: roundedQuotations,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Error fetching paginated quotations by email:", error);
    res.status(500).json({ message: error.message });
  }
};

// ✅ ดึง Quotation ตาม Email ของ createdByUser และกรองตามปี (default ปีปัจจุบัน)
exports.getQuotationsByEmail = async (req, res) => {
  const { email } = req.params;
  const { year } = req.query;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // ✅ กำหนดปี (ถ้าไม่ส่งมาใช้ปีปัจจุบัน)
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      createdByUser: email,
      documentDate: { $gte: start, $lt: end },
    };

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus cancelDate reason canceledBy remark CreditTerm isDetailedForm"
      )
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      );

    // ✅ ปัดเศษค่าตัวเลขก่อนส่งกลับ
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

// ✅ ดึงใบเสนอราคาแบบแบ่งหน้า พร้อม client และรองรับปี (default = ปีปัจจุบัน)
exports.getQuotationsWithPagination = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { year } = req.query;

    const query = {};

    // ✅ ถ้าไม่ส่ง year มา → ใช้ปีปัจจุบันแทน
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);
    query.documentDate = { $gte: start, $lt: end };

    const [quotations, total] = await Promise.all([
      Quotation.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate(
          "clientId",
          "customerName address taxIdentificationNumber contactPhoneNumber"
        )
        .populate({
          path: "approvalHierarchy",
          select: "quotationId approvalHierarchy",
          populate: {
            path: "approvalHierarchy",
            select: "level approver status",
          },
        }),
      Quotation.countDocuments(query),
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
      .sort({ createdAt: -1 })
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus reason remark CreditTerm approvalHierarchy"
      )
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      ) // ✅ เพิ่มข้อมูลลูกค้า
      .populate({
        path: "approvalHierarchy",
        select: "quotationId approvalHierarchy",
        populate: {
          path: "approvalHierarchy",
          select: "level approver status",
        },
      });

    const filteredQuotations = quotations.filter((qt) => {
      if (!qt.approvalHierarchy || qt.approvalHierarchy.length === 0)
        return false;
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
      return res
        .status(404)
        .json({ message: "Approval flow not found for this quotation" });
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
