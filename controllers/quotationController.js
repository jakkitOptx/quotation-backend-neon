// quotationController.js
const crypto = require("crypto");
const _ = require("lodash"); // ✅ Import lodash
const { GetObjectCommand } = require("@aws-sdk/client-s3");
const Approval = require("../models/Approval");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Log = require("../models/Log"); // ✅ import Log model
const { sendMail } = require("../utils/mailer");
const {
  uploadBufferToS3,
  generateSignedS3Url,
  s3,
  extractS3KeyFromUrl,
} = require("../utils/s3Client");

// ✅ ฟังก์ชันปัดเศษแบบพิเศษ (ปัดขึ้นหากทศนิยมหลักที่ 3 >= 5)
const roundUp = (num) => {
  return (num * 100) % 1 >= 0.5 ? _.ceil(num, 2) : _.round(num, 2);
};

const createCustomerSigningToken = () => crypto.randomBytes(32).toString("hex");

const hashCustomerSigningToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

const normalizeEmailList = (value) => {
  if (!value) return [];
  const items = Array.isArray(value) ? value : String(value).split(",");

  return items
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);
};

const buildCustomerSigningUrl = (token, quotationId) => {
  const rawBaseUrl =
    process.env.CUSTOMER_SIGNING_URL_BASE ||
    process.env.FRONTEND_URL ||
    "https://neonworksfi.com/customer-sign";
  const baseUrl = String(rawBaseUrl).replace(/\/+$/, "");
  const query = quotationId
    ? `?quotationId=${encodeURIComponent(String(quotationId))}`
    : "";

  return `${baseUrl}/${token}${query}`;
};

const formatQuotationNumber = (quotation) => {
  const docYear = new Date(quotation.documentDate).getFullYear();
  const companyPrefix = quotation.createdByUser?.includes("@optx")
    ? "OPTX"
    : "NW-QT";
  const runFormatted = String(quotation.runNumber || "").padStart(3, "0");

  return `${companyPrefix}(${quotation.type})-${docYear}-${runFormatted}`;
};

const getRequestIpAddress = (req) => {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (forwardedFor) {
    return String(forwardedFor).split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "";
};

const parseBase64Image = (value = "") => {
  const match = String(value).match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/);
  if (!match) return null;

  const contentType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extension = contentType.split("/")[1] === "jpeg" ? "jpg" : contentType.split("/")[1];

  return {
    buffer: Buffer.from(match[2], "base64"),
    contentType,
    extension,
  };
};

const uploadCustomerSignatureImage = async ({ quotationId, signatureImageBase64 }) => {
  const bucket = process.env.AWS_BUCKET;
  const folder = process.env.AWS_CUSTOMER_SIGNATURE_FOLDER || "customer-signatures";
  const parsedImage = parseBase64Image(signatureImageBase64);

  if (!parsedImage) {
    throw new Error("Invalid signature image base64");
  }

  if (!bucket || !process.env.AWS_REGION) {
    throw new Error("S3 configuration is incomplete");
  }

  const result = await uploadBufferToS3({
    bucket,
    folder: `${folder}/${quotationId}`,
    fileName: `customer-signature.${parsedImage.extension}`,
    buffer: parsedImage.buffer,
    contentType: parsedImage.contentType,
  });

  return result.url;
};

const createCustomerSignatureSignedUrl = async (signatureUrl = "") => {
  if (!signatureUrl) return "";
  if (String(signatureUrl).startsWith("data:")) return signatureUrl;

  const bucket = process.env.AWS_BUCKET;

  if (!bucket || !process.env.AWS_REGION) {
    throw new Error("S3 configuration is incomplete");
  }

  const result = await generateSignedS3Url({
    bucket,
    key: signatureUrl,
  });

  return result.url;
};

const streamToBuffer = async (stream) => {
  if (stream?.transformToByteArray) {
    return Buffer.from(await stream.transformToByteArray());
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks)));
  });
};

const createCustomerSignatureDataUrl = async (signatureUrl = "") => {
  if (!signatureUrl) return "";
  if (String(signatureUrl).startsWith("data:")) return signatureUrl;

  const bucket = process.env.AWS_BUCKET;
  const key = extractS3KeyFromUrl(signatureUrl);

  if (!bucket || !key) return "";

  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    })
  );
  const buffer = await streamToBuffer(result.Body);
  const contentType = result.ContentType || "image/png";

  return `data:${contentType};base64,${buffer.toString("base64")}`;
};

// ✅ สร้างใบ Quotation ใหม่ (Neonworks version ใส่ department + รองรับ Draft)
// FIX: runNumber แยกตามปี (documentDate) ไม่เอาปีเก่ามาปนปีใหม่
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

    if (!documentDate) {
      return res.status(400).json({ message: "Document Date is required" });
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

    // ✅ Neon: fee เป็น "จำนวนเงิน" (ห้ามเปลี่ยน)
    const calFee = roundUp(fee); // ใช้จำนวนเงิน fee ที่ถูกส่งมาจาก frontend
    const total = roundUp(totalBeforeFee + calFee);
    const amountBeforeTax = roundUp(total - discount);
    const vat = roundUp(amountBeforeTax * 0.07);
    const netAmount = roundUp(amountBeforeTax + vat);

    // ✅ ใช้ปีจาก documentDate (สำคัญมากสำหรับ runNumber)
    const docYear = new Date(documentDate).getFullYear();
    if (Number.isNaN(docYear)) {
      return res.status(400).json({ message: "Invalid documentDate" });
    }

    // ✅ หา runNumber ที่ว่างอยู่ใน type + ปีนั้น และเริ่มจากค่าใน .env
    const startRunEnvKey = `START_RUN_${type.toUpperCase()}`;
    const startRunNumber = parseInt(process.env[startRunEnvKey], 10) || 1;

    const yearStart = new Date(`${docYear}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${docYear + 1}-01-01T00:00:00.000Z`);

    const existingQuotations = await Quotation.find({
      type,
      documentDate: { $gte: yearStart, $lt: yearEnd },
    }).select("runNumber");

    const existingRunNumbers = existingQuotations
      .map((q) => Number(q.runNumber))
      .filter((n) => !Number.isNaN(n));

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
      approvalStatus: isDraft ? "Draft" : "Pending",
      remark,
      CreditTerm,
      isDetailedForm,
      isSpecialForm,
      numberOfSpecialPages,
    });

    await quotation.save();

    // ✅ สร้าง log (ใช้ docYear ที่คำนวณไว้แล้ว)
    const companyPrefix = createdByUser.includes("@optx") ? "OPTX" : "NW-QT";
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
        "customerName address taxIdentificationNumber contactPhoneNumber companyBaseName"
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

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const skip = (page - 1) * limit;
  const { year } = req.query;

  try {
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // ✅ ใช้ user จาก token (authMiddleware set ให้แล้ว)
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // ✅ กันยิงดูของคนอื่น (ยกเว้น admin)
    // email param ควรตรงกับคนที่ login อยู่
    if (user.role !== "admin" && user.username !== email) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };

    // ✅ Debug ได้ตามต้องการ
    console.log("user.teamGroup getQuotationsByEmailPaginated ==>", user.teamGroup);

    // ✅ Admin เห็นทั้งหมดของปีนั้น
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
        "customerName address taxIdentificationNumber contactPhoneNumber companyBaseName"
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

    return res.status(200).json({
      data: roundedQuotations,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error("Error fetching paginated quotations by email:", error);
    return res.status(500).json({ message: error.message });
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

    // ✅ ใช้ user จาก token
    const user = req.user;
    if (!user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // ✅ กัน user ยิงดูของคนอื่น (ยกเว้น admin)
    if (user.role !== "admin" && user.username !== email) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const selectedYear = year ? parseInt(year, 10) : new Date().getFullYear();
    const start = new Date(`${selectedYear}-01-01T00:00:00.000Z`);
    const end = new Date(`${selectedYear + 1}-01-01T00:00:00.000Z`);

    const query = {
      documentDate: { $gte: start, $lt: end },
    };

    // ✅ role filter ตาม user ที่ login จริง
    if (user.role !== "admin") {
      if (user.level >= 3) {
        query.department = user.department;
      } else if (user.level === 2) {
        query.teamGroup = user.teamGroup;
      } else {
        query.createdByUser = user.username;
      }
    }

    const quotations = await Quotation.find(query)
      .sort({ createdAt: -1 })
      .populate(
        "clientId",
        "customerName address taxIdentificationNumber contactPhoneNumber companyBaseName"
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

    return res.status(200).json(roundedQuotations);
  } catch (error) {
    console.error("Error fetching quotations by email:", error);
    return res.status(500).json({ message: error.message });
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
          "customerName address taxIdentificationNumber contactPhoneNumber companyBaseName"
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
        "customerName address taxIdentificationNumber contactPhoneNumber companyBaseName"
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

    // ✅ ออกเลข runNumber ใหม่ (FIX: ดูเฉพาะปีปัจจุบัน ไม่เอาปีก่อนมาปน)
    const type = originalQT.type || "M";
    const startRunEnvKey = `START_RUN_${type.toUpperCase()}`;
    const startRunNumber = parseInt(process.env[startRunEnvKey], 10) || 1;

    // ปีปัจจุบัน (เพราะ duplicate จะ set documentDate = new Date())
    const docYear = new Date().getFullYear();
    const yearStart = new Date(`${docYear}-01-01T00:00:00.000Z`);
    const yearEnd = new Date(`${docYear + 1}-01-01T00:00:00.000Z`);

    // ✅ สำคัญ: filter ตาม type + ปีปัจจุบันเท่านั้น
    const existingQuotations = await Quotation.find({
      type,
      documentDate: { $gte: yearStart, $lt: yearEnd },
    }).select("runNumber");

    const existingRunNumbers = existingQuotations
      .map((q) => Number(q.runNumber))
      .filter((n) => !Number.isNaN(n));

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
      customerApproval,
      customerSignature,
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
      customerApproval: {
        status: "Not Sent",
        to: "",
        cc: [],
        tokenHash: "",
        sentAt: null,
        viewedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: null,
      },
      customerSignature: {
        imageUrl: "",
        signerName: "",
        signerEmail: "",
        signedAt: null,
        ipAddress: "",
        userAgent: "",
        documentHash: "",
      },
      approvalHierarchy: [],
      items: sanitizedItems,
      createdAt: new Date(),
      updatedAt: new Date(),
      documentDate: new Date(),
      cancelDate: null,
      reason: null,
      canceledBy: null,

      // 🟢 ใช้ของ original QT (ตาม logic เดิม)
      department: user.department,
      team: user.team || "",
      teamGroup: user.teamGroup || "",

      // 🟣 เพิ่ม "(Duplicated)"
      title: `${originalQT.title} (Duplicated)`,
      projectName: `${originalQT.projectName} (Duplicated)`,

      // 🔥 FIX เดิมของคุณ
      createdByUser: req.user.username,
      createBy: req.user.username,
      proposedBy: req.user.username,
    };

    // ✅ สร้างเอกสารใหม่ (Mongo จะ gen _id ใหม่ให้อัตโนมัติ)
    const duplicatedQT = await Quotation.create(duplicatedPayload);

    // ✅ Log การ duplicate (คง logic เดิม แต่ใช้ docYear ปีปัจจุบันให้ตรงกับเลข)
    const companyPrefix = originalQT.createdByUser.includes("@optx")
      ? "OPTX"
      : "NW-QT";
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
    const { year } = req.query;

    // ถ้าไม่ส่ง year มา ใช้ปีปัจจุบัน
    const now = new Date();
    const selectedYear = Number.isInteger(parseInt(year, 10))
      ? parseInt(year, 10)
      : now.getFullYear();

    if (selectedYear < 2000 || selectedYear > 3000) {
      return res.status(400).json({ message: "Invalid year" });
    }

    // ช่วงปี (ใช้แบบ range จะเร็วและใช้ index ได้)
    const yearStart = new Date(selectedYear, 0, 1, 0, 0, 0, 0);
    const yearEnd = new Date(selectedYear + 1, 0, 1, 0, 0, 0, 0);

    const match = {
      documentDate: { $gte: yearStart, $lt: yearEnd },
    };

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
    const { id } = req.params; // quotationId
    const { email } = req.body; // user ที่จะใช้ flow ของเขา

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

exports.sendQuotationToCustomer = async (req, res) => {
  try {
    const { id } = req.params;
    const { to, cc, expiresInDays = 14 } = req.body;
    const cleanTo = String(to || "").trim().toLowerCase();
    const cleanCc = normalizeEmailList(cc);
    const days = Math.max(1, Number(expiresInDays) || 14);

    if (!cleanTo) {
      return res.status(400).json({ message: "Customer email is required" });
    }

    const quotation = await Quotation.findById(id).populate(
      "clientId",
      "customerName companyBaseName email"
    );

    if (!quotation) {
      return res.status(404).json({ message: "Quotation not found" });
    }

    if (quotation.approvalStatus !== "Approved") {
      return res.status(400).json({
        message: "Only approved quotations can be sent to customer",
      });
    }

    if (quotation.customerApproval?.status === "Accepted") {
      return res.status(409).json({
        message: "Customer has already accepted this quotation",
      });
    }

    const token = createCustomerSigningToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const signingUrl = buildCustomerSigningUrl(token, quotation._id);
    const quotationNumber = formatQuotationNumber(quotation);

    quotation.customerApproval = {
      status: "Sent",
      to: cleanTo,
      cc: cleanCc,
      tokenHash: hashCustomerSigningToken(token),
      sentAt: now,
      viewedAt: null,
      acceptedAt: null,
      rejectedAt: null,
      expiresAt,
    };
    quotation.customerSignature = {
      imageUrl: "",
      signerName: "",
      signerEmail: "",
      signedAt: null,
      ipAddress: "",
      userAgent: "",
      documentHash: "",
    };

    await quotation.save();

    try {
      await sendMail({
        to: cleanTo,
        cc: cleanCc,
        subject: `Quotation ${quotationNumber} is ready for signature`,
        text: `Please review and sign quotation ${quotationNumber}: ${signingUrl}`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #222; line-height: 1.5;">
            <p>Dear Customer,</p>
            <p>Please review and sign quotation <strong>${quotationNumber}</strong>.</p>
            <p>
              <a href="${signingUrl}" style="display: inline-block; padding: 10px 16px; background: #111827; color: #ffffff; text-decoration: none; border-radius: 6px;">
                Open Quotation
              </a>
            </p>
            <p>If the button does not work, please open this link:</p>
            <p><a href="${signingUrl}">${signingUrl}</a></p>
            <p>This signing link expires on ${expiresAt.toISOString()}.</p>
          </div>
        `,
      });
    } catch (mailError) {
      quotation.customerApproval = {
        status: "Not Sent",
        to: cleanTo,
        cc: cleanCc,
        tokenHash: "",
        sentAt: null,
        viewedAt: null,
        acceptedAt: null,
        rejectedAt: null,
        expiresAt: null,
      };
      await quotation.save();

      console.error("Send quotation customer email failed:", mailError);
      return res.status(502).json({
        message: "Failed to send customer email",
        error: mailError.message,
      });
    }

    const performedBy = req.user?.username || "unknown";
    await Log.create({
      quotationId: quotation._id,
      action: "send_to_customer",
      performedBy,
      description: `Sent quotation ${quotationNumber} to ${cleanTo}`,
    });

    return res.status(200).json({
      message: "Quotation sent to customer successfully",
      data: {
        quotationId: quotation._id,
        quotationNumber,
        customerApproval: {
          status: quotation.customerApproval.status,
          to: quotation.customerApproval.to,
          cc: quotation.customerApproval.cc,
          sentAt: quotation.customerApproval.sentAt,
          expiresAt: quotation.customerApproval.expiresAt,
        },
        signingUrl,
      },
    });
  } catch (error) {
    console.error("Error sending quotation to customer:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.acceptCustomerSignature = async (req, res) => {
  try {
    const { token } = req.params;
    const {
      signatureImageBase64,
      signatureImageUrl,
      imageUrl,
      signerName,
      signerEmail,
      documentHash,
    } = req.body;

    if (!token) {
      return res.status(400).json({ message: "Signing token is required" });
    }

    const quotation = await Quotation.findOne({
      "customerApproval.tokenHash": hashCustomerSigningToken(token),
    });

    if (!quotation) {
      return res.status(404).json({ message: "Invalid signing token" });
    }

    if (
      quotation.customerApproval?.expiresAt &&
      quotation.customerApproval.expiresAt < new Date()
    ) {
      quotation.customerApproval.status = "Expired";
      await quotation.save();

      return res.status(410).json({ message: "Signing token has expired" });
    }

    if (quotation.customerApproval?.status === "Accepted") {
      return res.status(409).json({ message: "Quotation already accepted" });
    }

    if (quotation.customerApproval?.status === "Rejected") {
      return res.status(409).json({ message: "Rejected quotation cannot be accepted" });
    }

    let signatureUrl = signatureImageUrl || imageUrl;

    if (!signatureUrl && signatureImageBase64) {
      signatureUrl = await uploadCustomerSignatureImage({
        quotationId: quotation._id,
        signatureImageBase64,
      });
    }

    if (!signatureUrl) {
      return res.status(400).json({ message: "Signature image url is required" });
    }

    const now = new Date();
    const acceptedEmail = String(
      signerEmail || quotation.customerApproval?.to || ""
    )
      .trim()
      .toLowerCase();

    quotation.approvalStatus = "Approved";
    quotation.customerApproval.status = "Accepted";
    quotation.customerApproval.acceptedAt = now;
    quotation.customerSignature = {
      imageUrl: signatureUrl,
      signerName: String(signerName || "").trim(),
      signerEmail: acceptedEmail,
      signedAt: now,
      ipAddress: getRequestIpAddress(req),
      userAgent: req.get("user-agent") || "",
      documentHash: String(documentHash || "").trim(),
    };

    await quotation.save();

    await Log.create({
      quotationId: quotation._id,
      action: "customer_sign_accept",
      performedBy: acceptedEmail || "customer",
      description: `Customer accepted quotation ${formatQuotationNumber(quotation)}`,
    });

    const customerSignature =
      quotation.customerSignature?.toObject?.() || quotation.customerSignature || {};
    const [signedImageUrl, imageDataUrl] = await Promise.all([
      createCustomerSignatureSignedUrl(customerSignature.imageUrl),
      createCustomerSignatureDataUrl(customerSignature.imageUrl),
    ]);

    return res.status(200).json({
      message: "Quotation accepted successfully",
      data: {
        quotationId: quotation._id,
        approvalStatus: quotation.approvalStatus,
        customerApproval: {
          status: quotation.customerApproval.status,
          acceptedAt: quotation.customerApproval.acceptedAt,
        },
        customerSignature: {
          ...customerSignature,
          signedImageUrl,
          imageDataUrl,
        },
      },
    });
  } catch (error) {
    console.error("Error accepting customer signature:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.getCustomerSignatureSignedUrl = async (req, res) => {
  try {
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ message: "Signing token is required" });
    }

    const quotation = await Quotation.findOne({
      "customerApproval.tokenHash": hashCustomerSigningToken(token),
    }).select("customerApproval customerSignature");

    if (!quotation) {
      return res.status(404).json({ message: "Invalid signing token" });
    }

    if (
      quotation.customerApproval?.expiresAt &&
      quotation.customerApproval.expiresAt < new Date()
    ) {
      return res.status(410).json({ message: "Signing token has expired" });
    }

    const imageUrl = quotation.customerSignature?.imageUrl || "";

    if (!imageUrl) {
      return res.status(404).json({ message: "Customer signature image not found" });
    }

    const [signedImageUrl, imageDataUrl] = await Promise.all([
      createCustomerSignatureSignedUrl(imageUrl),
      createCustomerSignatureDataUrl(imageUrl),
    ]);

    return res.status(200).json({
      data: {
        imageUrl,
        signedImageUrl,
        imageDataUrl,
      },
    });
  } catch (error) {
    console.error("Error generating customer signature signed URL:", error);
    return res.status(500).json({ message: error.message });
  }
};

// ✅ อัปเดต department อัตโนมัติสำหรับเอกสารที่ยังเป็น N/A หรือ Unknown
exports.fixMissingDepartments = async (req, res) => {
  try {
    console.time("fixMissingDepartments");

    // ✅ ตรวจสอบสิทธิ์ admin
    const tokenUser =
      (req.userId && (await User.findById(req.userId))) ||
      (req.user?.username &&
        (await User.findOne({ username: req.user.username })));

    if (!tokenUser || tokenUser.role !== "admin") {
      return res.status(403).json({
        message: "Permission denied. Admin only.",
        detail: "ไม่พบข้อมูลผู้ใช้ หรือสิทธิ์ไม่เพียงพอ",
      });
    }

    // ✅ ดึงเฉพาะเอกสารที่ department ยังไม่ถูกต้อง
    const quotations = await Quotation.find({
      $or: [
        { department: "N/A" },
        { department: "Unknown" },
        { department: null },
        { department: "" },
      ],
    }).select("_id runNumber createdByUser department");

    if (!quotations.length) {
      return res.status(200).json({ message: "✅ ไม่มีเอกสารที่ต้องอัปเดต" });
    }

    // ✅ ดึงข้อมูลผู้ใช้ทั้งหมดที่เกี่ยวข้องเพียงครั้งเดียว (ลดจำนวน query)
    const usernames = [...new Set(quotations.map((q) => q.createdByUser))];
    const users = await User.find({ username: { $in: usernames } }).select(
      "username department"
    );

    // ✅ ทำ mapping username → department
    const deptMap = Object.fromEntries(
      users.map((u) => [u.username, u.department])
    );

    // ✅ เตรียม bulk operation
    const bulkOps = quotations
      .map((qt) => {
        const newDept = deptMap[qt.createdByUser];
        if (newDept && newDept !== qt.department) {
          return {
            updateOne: {
              filter: { _id: qt._id },
              update: { $set: { department: newDept } },
            },
          };
        }
        return null;
      })
      .filter(Boolean);

    if (!bulkOps.length) {
      return res.status(200).json({
        message: "✅ ไม่มีเอกสารที่ต้องอัปเดตเพิ่มเติม",
      });
    }

    // ✅ ใช้ bulkWrite เพื่อ update ครั้งเดียว (เร็วมาก)
    await Quotation.bulkWrite(bulkOps);

    console.timeEnd("fixMissingDepartments");

    res.status(200).json({
      message: `✅ อัปเดตสำเร็จ ${bulkOps.length} เอกสาร`,
      updatedCount: bulkOps.length,
    });
  } catch (error) {
    console.error("❌ Error fixing departments:", error);
    res.status(500).json({
      message: "เกิดข้อผิดพลาดภายในระบบ",
      error: error.message,
    });
  }
};
