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
      approvalStatus: { $ne: "Draft" }, // ✅ ไม่เอา Draft
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

      return hierarchy[approverIndex].status === "Pending" && isReadyToApprove;
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

    // ✅ บันทึก Log (ใช้ข้อมูลจาก token โดยไม่ต้อง query DB)
    const user = req.user;
    const performedBy = user?.username || "unknown";

    // ✅ ใช้ prefix เดียวกับ OPTX/Neon (OPTX หรือ NW-QT)
    const companyPrefix = performedBy.includes("@optx")
      ? "OPTX"
      : "NW-QT";

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

    // ใช้ .lean() เพื่อได้ plain object (จัดการ field ได้ง่ายและป้องกัน accidental save)
    const originalQT = await Quotation.findById(id).lean();
    if (!originalQT) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    // ✅ ดึงข้อมูล user ที่เป็นเจ้าของเอกสาร (ตาม logic เดิมของคุณ)
    const user = await User.findOne({ username: originalQT.createdByUser });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ ออกเลข runNumber ใหม่ (logic เดิม)
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

    // ✅ เตรียมข้อมูลสำหรับเอกสารใหม่
    //    - ลบ _id, id, createdAt, updatedAt เดิม
    //    - ล้าง approvalHierarchy (อย่าอ้างอิงของเดิม)
    //    - ลบ _id ของ items ทุกตัว
    const sanitizedItems = (originalQT.items || []).map((it) => {
      const { _id, id, ...rest } = it;
      return { ...rest };
    });

    const {
      _id,
      id: idVirtual,
      createdAt,
      updatedAt,
      approvalHierarchy,
      approvedBy,
      cancelDate,
      canceledBy,
      reason, // จะรีเซ็ตค่าใหม่
      ...restOriginal
    } = originalQT;

    const duplicatedPayload = {
      ...restOriginal,
      runNumber: newRunNumber,
      approvalStatus: "Pending",
      approvedBy: undefined,
      approvalHierarchy: [], // ⬅️ สำคัญ: อย่า copy ของเก่า (กัน _id ซ้ำ และสถานะอนุมัติซ้ำ)
      items: sanitizedItems,
      createdAt: new Date(),
      updatedAt: new Date(),
      documentDate: new Date(),
      cancelDate: null,
      reason: null,
      canceledBy: null,
      // อัปเดตข้อมูล user ปัจจุบัน (ตามโค้ดเดิมของคุณ)
      department: user.department,
      team: user.team || "",
      teamGroup: user.teamGroup || "",
      // ✅ เพิ่มคำ "(Duplicated)" ใน title และ projectName
      title: `${originalQT.title} (Duplicated)`,
      projectName: `${originalQT.projectName} (Duplicated)`,
    };

    // ✅ สร้างเอกสารใหม่ (Mongo จะ gen _id ใหม่ให้อัตโนมัติ)
    const duplicatedQT = await Quotation.create(duplicatedPayload);

    // ✅ Log การ duplicate (logic เดิม)
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

    res.status(201).json({
      _id: duplicatedQT._id,
      runNumber: duplicatedQT.runNumber,
      type: duplicatedQT.type,
      message: "Duplicated successfully",
    });
  } catch (error) {
    console.error("Error duplicating quotation:", error);
    res.status(500).json({ message: error.message });
  }
};

// GET /quotations/summary?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
// สรุปยอด total / pending / approved ใน query เดียว
exports.getQuotationsSummary = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // เงื่อนไขกรองเสริม (ถ้าไม่ส่งมาจะไม่นำมาใช้)
    const match = {};
    if (startDate || endDate) {
      match.documentDate = {};
      if (startDate) match.documentDate.$gte = new Date(startDate);
      if (endDate) match.documentDate.$lte = new Date(endDate);
    }

    const [summary] = await Quotation.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          pending: {
            $sum: {
              $cond: [{ $eq: ["$approvalStatus", "Pending"] }, 1, 0],
            },
          },
          approved: {
            $sum: {
              $cond: [{ $eq: ["$approvalStatus", "Approved"] }, 1, 0],
            },
          },
        },
      },
      { $project: { _id: 0, total: 1, pending: 1, approved: 1 } },
    ]);

    res.json(summary || { total: 0, pending: 0, approved: 0 });
  } catch (err) {
    console.error("getQuotationsSummary error:", err);
    res.status(500).json({ message: "Failed to get summary" });
  }
};

exports.updateApprovalFlow = async (req, res) => {
  try {
    const { id } = req.params;        // quotationId
    const { email } = req.body;       // user ที่จะใช้ flow ของเขา

    const quotation = await Quotation.findById(id);
    if (!quotation)
      return res.status(404).json({ message: "Quotation not found" });

    // ✅ หาผู้ใช้
    const userEmail = email || quotation.createdByUser;
    const user = await User.findOne({ username: userEmail });
    if (!user) return res.status(404).json({ message: "User not found" });

    // ✅ ดึง flow ล่าสุดของ user จาก ApproveFlow
    const ApproveFlow = require("../models/ApproveFlow");
    const templateFlow = await ApproveFlow.findById(user.flow);
    if (!templateFlow)
      return res.status(404).json({ message: "Approve flow not found" });

    // ✅ ลบ flow เดิม (Approval instance เดิม)
    await Approval.deleteMany({ quotationId: quotation._id });

    // ✅ สร้าง Approval ใหม่จาก template
    const newApproval = await Approval.create({
      quotationId: quotation._id,
      approvalHierarchy: templateFlow.approvalHierarchy.map((step) => ({
        level: step.level,
        approver: step.approver,
        status: "Pending",
        approvedAt: null,
      })),
    });

    // ✅ อัปเดต Quotation ให้ชี้ flow ใหม่
    quotation.approvalHierarchy = [newApproval._id];
    quotation.approvalStatus = "Pending";
    await quotation.save();

    // ✅ Log การเปลี่ยนแปลง
    await Log.create({
      quotationId: quotation._id,
      action: "update_flow",
      performedBy: userEmail,
      description: `Updated approval flow from ApproveFlow template by ${userEmail}`,
    });

    res.status(200).json({
      message: "Approval flow updated successfully",
      quotation,
    });
  } catch (error) {
    console.error("Error updating approval flow:", error);
    res.status(500).json({ message: error.message });
  }
};

// ✅ อัปเดต department อัตโนมัติสำหรับเอกสารที่ยังเป็น N/A หรือ Unknown
exports.fixMissingDepartments = async (req, res) => {
  try {
    // ✅ ดึงข้อมูลผู้ใช้งานจาก token
    const tokenUser = await User.findById(req.userId);
    const user =
      tokenUser || (await User.findOne({ username: req.username || req.user?.username }));

    // ✅ ตรวจสอบสิทธิ์ admin
    if (!user || user.role !== "admin") {
      return res.status(403).json({
        message: "Permission denied. Admin only.",
        detail: "ไม่พบข้อมูลผู้ใช้ หรือสิทธิ์ไม่เพียงพอ",
      });
    }

    // ✅ ดึงเอกสารทั้งหมดที่ department ยังไม่ถูกต้อง
    const quotations = await Quotation.find({
      $or: [
        { department: "N/A" },
        { department: "Unknown" },
        { department: null },
        { department: "" },
      ],
    });

    if (quotations.length === 0) {
      return res.status(200).json({ message: "✅ ไม่มีเอกสารที่ต้องอัปเดต" });
    }

    const updatedDocs = [];

    for (const qt of quotations) {
      const creator = await User.findOne({ username: qt.createdByUser });
      if (creator && creator.department) {
        qt.department = creator.department;
        await qt.save();

        updatedDocs.push({
          id: qt._id,
          runNumber: qt.runNumber,
          createdBy: qt.createdByUser,
          updatedTo: creator.department,
        });
      }
    }

    res.status(200).json({
      message: `✅ อัปเดตสำเร็จ ${updatedDocs.length} เอกสาร`,
      updatedDocs,
    });
  } catch (error) {
    console.error("Error fixing departments:", error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  }
};
