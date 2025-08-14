// quotationController.js
const _ = require("lodash"); // ✅ Import lodash
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Log = require("../models/Log"); // ✅ import Log model

// ✅ ฟังก์ชันปัดเศษแบบพิเศษ (ปัดขึ้นหากทศนิยมหลักที่ 3 >= 5)
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

// ✅ สร้างใบ Quotation ใหม่ (version ใส่ department + รองรับ Draft)
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
    createdByUser,
    type = "M",
    items,
    discount = 0,
    fee = 0,
    remark = "",
    CreditTerm = 0,
    isDetailedForm = false,
    isSpecialForm = false,
    numberOfSpecialPages = 1,
    isDraft = false, // ✅ รับค่าจาก frontend
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
    // แก้สูตร
    // ✅ คำนวณ fee, total, amountBeforeTax, vat, netAmount
    const calFee = roundUp(fee); // ใช้จำนวนเงิน fee ที่ถูกส่งมาจาก frontend
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
      department: user.department,
      team: user.team || "",
      teamGroup: user.teamGroup || "",
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
      approvalStatus: isDraft ? "Draft" : "Pending", // ✅ ถ้า isDraft = true ให้เป็น Draft
      remark,
      CreditTerm,
      isDetailedForm,
      isSpecialForm,
      numberOfSpecialPages,
    });

    await quotation.save();

    // ✅ สร้าง log
    const companyPrefix = createdByUser.includes("@optx") ? "OPTX" : "NW-QT";
    const docYear = new Date(documentDate).getFullYear();
    const qtNumber = `${companyPrefix}(${type})-${docYear}-${newRunNumber}`;

    await Log.create({
      quotationId: quotation._id,
      action: isDraft ? "save_draft" : "create",
      performedBy: createdByUser,
      description: isDraft
        ? `Saved draft quotation ${qtNumber}`
        : `Created quotation ${qtNumber}`,
    });

    res.status(201).json(quotation);
  } catch (error) {
    console.error("Error creating quotation:", error);
    res.status(400).json({ message: error.message });
  }
};

exports.getQuotations = async (req, res) => {
  try {
    const { year, email } = req.query;
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };

    if (email) {
      const user = await User.findOne({ username: email });
      console.log("user.teamGroup getQuotations==>", user.teamGroup);
      if (user.role !== "admin") {
        if (user.level >= 3) {
          query.department = user.department;
        } else if (user.level === 2) {
          query.teamGroup = user.teamGroup;
        } else {
          query.createdByUser = user.username; // lv.1 ดูเฉพาะของตัวเอง
        }
      }
    }

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
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
      });

    res.status(200).json(quotations);
  } catch (error) {
    console.error("Error fetching quotations:", error);
    res.status(500).json({ message: error.message });
  }
};
// ✅ ดึง Quotation ตาม email พร้อมแบ่งหน้า และรองรับ query ปี + รองรับ department
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

    const user = await User.findOne({ username: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };
    console.log(
      "user.teamGroup getQuotationsByEmailPaginated ==>",
      user.teamGroup
    );
    if (user.role !== "admin") {
      if (user.level >= 3) {
        query.department = user.department;
      } else if (user.level === 2) {
        query.teamGroup = user.teamGroup;
      } else {
        query.createdByUser = user.username; // lv.1 ดูเฉพาะของตัวเอง
      }
    }

    const total = await Quotation.countDocuments(query);

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      );

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

// ✅ ดึง Quotation ตาม Email ของ User และกรองตามปี (default ปีปัจจุบัน) + รองรับ role filter
exports.getQuotationsByEmail = async (req, res) => {
  const { email } = req.params;
  const { year } = req.query;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ username: email });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };
    if (user.role !== "admin") {
      if (user.level >= 3) {
        query.department = user.department;
      } else if (user.level === 2) {
        query.teamGroup = user.teamGroup;
      } else {
        query.createdByUser = user.username; // lv.1 ดูเฉพาะของตัวเอง
      }
    }

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber"
      );

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

// ✅ ดึงใบเสนอราคาแบบแบ่งหน้า พร้อม client และรองรับปี (default = ปีปัจจุบัน) + รองรับ department
exports.getQuotationsWithPagination = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { year, email } = req.query;

    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };

    if (email) {
      const user = await User.findOne({ username: email });
      console.log(
        "user.teamGroup getQuotationsWithPagination ==>",
        user.teamGroup
      );

      if (user.role !== "admin") {
        if (user.level >= 3) {
          query.department = user.department;
        } else if (user.level === 2) {
          query.teamGroup = user.teamGroup;
        } else {
          query.createdByUser = user.username; // lv.1 ดูเฉพาะของตัวเอง
        }
      }
    }

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

// ✅ ดึง Quotation ที่ต้อง Approve ตาม Email และรองรับ filter by year ด้วย
exports.getApprovalQuotationsByEmail = async (req, res) => {
  const { email } = req.params;
  const { year } = req.query;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const selectedYear = year ? parseInt(year) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const quotations = await Quotation.find({
      documentDate: { $gte: start, $lt: end }, // ✅ filter by year
      approvalStatus: { $ne: "Draft" },        // ✅ ไม่เอา Draft
    })
      .sort({ createdAt: -1 })
      .select(
        "title client clientId salePerson documentDate productName projectName period startDate endDate createBy proposedBy createdByUser amount discount fee calFee totalBeforeFee total amountBeforeTax vat netAmount type runNumber items approvalStatus reason remark CreditTerm approvalHierarchy"
      )
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
      });

    // ✅ filter ที่ถึงคิว approver คนนี้เท่านั้น และไม่เอาใบที่ Canceled
    const filteredQuotations = quotations.filter((qt) => {
      if (
        !qt.approvalHierarchy ||
        qt.approvalHierarchy.length === 0 ||
        qt.approvalStatus === "Canceled" // ✅ เพิ่มตรงนี้
      )
        return false;

      const hierarchy = qt.approvalHierarchy[0]?.approvalHierarchy || [];

      const approverIndex = hierarchy.findIndex(
        (level) => level.approver === email
      );

      if (approverIndex === -1) return false; // ไม่มีอีเมลนี้ใน flow

      const isReadyToApprove = hierarchy
        .slice(0, approverIndex)
        .every((level) => level.status === "Approved");

      return (
        hierarchy[approverIndex].status === "Pending" &&
        isReadyToApprove
      );
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

    // ✅ Reset สถานะทุก Level
    approval.approvalHierarchy = approval.approvalHierarchy.map((level) => ({
      ...level,
      status: "Pending",
      approvedAt: null,
    }));

    await approval.save();

    // ✅ เปลี่ยน Quotation เป็น Pending
    quotation.approvalStatus = "Pending";
    await quotation.save();

    // ✅ บันทึก Log
    const user = await User.findById(req.userId);
    const performedBy = user?.username || "unknown";

    const companyPrefix = performedBy.includes("@optx") ? "OPTX" : "NW-QT";

    const currentYear = new Date().getFullYear();
    const runFormatted = quotation.runNumber?.padStart(3, "0") || "???";
    const code = `${companyPrefix}(${quotation.type})-${currentYear}-${runFormatted}`;

    await Log.create({
      quotationId: quotation._id,
      action: "unlock",
      performedBy,
      description: `Reset approval flow for ${code}`,
    });

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

exports.duplicateQuotation = async (req, res) => {
  try {
    const { id } = req.params;
    const originalQT = await Quotation.findById(id);

    if (!originalQT) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    // ✅ ดึงข้อมูล user เพื่อเอา department, team ฯลฯ
    const user = await User.findOne({ username: originalQT.createdByUser });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ ใช้ logic สร้าง runNumber แบบเดียวกับ createQuotation
    const type = originalQT.type || "M";
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

    // ✅ Duplicate โดยคัดลอกข้อมูลทุกฟิลด์ ยกเว้น _id, createdAt, updatedAt
    const duplicatedQT = new Quotation({
      ...originalQT.toObject(),
      _id: undefined,
      isNew: true,
      runNumber: newRunNumber,
      approvalStatus: "Pending",
      createdAt: new Date(),
      updatedAt: new Date(),
      documentDate: new Date(),
      // อัปเดตข้อมูล user ปัจจุบัน (ถ้าต้องการ)
      department: user.department,
      team: user.team || "",
      teamGroup: user.teamGroup || "",
      // ✅ เพิ่มคำ "(Duplicated)" ใน title และ projectName
      title: `${originalQT.title} (Duplicated)`,
      projectName: `${originalQT.projectName} (Duplicated)`,
    });

    await duplicatedQT.save();

    // ✅ Log การ duplicate
    const companyPrefix = originalQT.createdByUser.includes("@optx")
      ? "OPTX"
      : "NW-QT";
    const docYear = new Date().getFullYear();
    const qtNumber = `${companyPrefix}(${type})-${docYear}-${newRunNumber}`;

    await Log.create({
      quotationId: duplicatedQT._id,
      action: "duplicate",
      performedBy: originalQT.createdByUser,
      description: `Duplicated quotation from ${originalQT.runNumber} to ${qtNumber}`,
    });

    res.status(201).json(duplicatedQT);
  } catch (error) {
    console.error("Error duplicating quotation:", error);
    res.status(500).json({ message: error.message });
  }
};
