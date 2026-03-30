const TravelExpense = require("../models/TravelExpense");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const { getDrivingDistance } = require("../services/googleRoutesService");
const { uploadBufferToS3 } = require("../utils/s3Client");

const buildApprovalLevels = (requesterLevel) => {
  const normalizedLevel = Number(requesterLevel) || 1;

  if (normalizedLevel <= 2) {
    return [3, 4];
  }

  return [4];
};

const createApprovalSteps = (requesterLevel) =>
  buildApprovalLevels(requesterLevel).map((level) => ({
    level,
    status: "Pending",
    actedBy: "",
    actedAt: null,
    rejectedReason: "",
  }));

const getCurrentApprovalStep = (doc) => {
  if (!Array.isArray(doc?.approvalSteps) || doc.approvalSteps.length === 0) {
    return null;
  }

  return (
    doc.approvalSteps.find((step) => step.status === "Pending") || null
  );
};

const syncCurrentApprovalLevel = (doc) => {
  const currentStep = getCurrentApprovalStep(doc);
  doc.currentApprovalLevel = currentStep ? Number(currentStep.level) : null;
  return currentStep;
};

const ensureApprovalFlow = async (doc) => {
  if (!doc) return doc;

  let hasChanges = false;

  if (!doc.requestedByLevel) {
    const requester = await User.findOne({ username: doc.requestedBy })
      .select("level")
      .lean();

    doc.requestedByLevel = Number(requester?.level) || 1;
    hasChanges = true;
  }

  if (!Array.isArray(doc.approvalSteps) || doc.approvalSteps.length === 0) {
    doc.approvalSteps = createApprovalSteps(doc.requestedByLevel);
    hasChanges = true;
  }

  const currentStep = getCurrentApprovalStep(doc);
  const nextLevel = currentStep ? Number(currentStep.level) : null;
  if (doc.currentApprovalLevel !== nextLevel) {
    doc.currentApprovalLevel = nextLevel;
    hasChanges = true;
  }

  if (hasChanges) {
    await doc.save();
  }

  return doc;
};

const resetTravelExpenseApprovalFlow = (doc) => {
  doc.status = "Pending";
  doc.approvedBy = "";
  doc.approvedAt = null;
  doc.rejectedReason = "";
  doc.approvalSteps = createApprovalSteps(doc.requestedByLevel);
  doc.currentApprovalLevel = buildApprovalLevels(doc.requestedByLevel)[0] || null;
};

const isSameApprovalScope = (user, doc) => {
  if (Number(user?.level) === 4) {
    return true;
  }

  return !!user?.department && user.department === doc.department;
};

const canApproveTravelExpense = (user, doc) => {
  if (!user || !doc) return false;

  if (user.role === "admin") return true;
  if (user.username === doc.requestedBy) return false;

  const currentStep = syncCurrentApprovalLevel(doc);
  if (!currentStep) return false;

  return (
    Number(user.level) === Number(currentStep.level) &&
    isSameApprovalScope(user, doc)
  );
};

const parseMoneyValue = (value) => {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const parseOptionalText = (value) => {
  if (typeof value !== "string") return "";
  return value.trim();
};

const resolveQuotationPayload = async ({
  quotationId,
  quotationNumber,
  quotationTitle,
  projectName,
}) => {
  const snapshot = {
    quotationId: null,
    quotationNumber: parseOptionalText(quotationNumber),
    quotationTitle: parseOptionalText(quotationTitle),
    projectName: parseOptionalText(projectName),
  };

  if (!quotationId) {
    return snapshot;
  }

  const quotation = await Quotation.findById(quotationId)
    .select("_id runNumber title projectName")
    .lean();

  if (!quotation) {
    const error = new Error("Quotation not found");
    error.statusCode = 400;
    throw error;
  }

  return {
    quotationId: quotation._id,
    quotationNumber:
      parseOptionalText(quotation.runNumber) || snapshot.quotationNumber,
    quotationTitle: parseOptionalText(quotation.title) || snapshot.quotationTitle,
    projectName:
      parseOptionalText(quotation.projectName) || snapshot.projectName,
  };
};

const canManageOwnPendingTravelExpense = (user, doc) => {
  if (!user || !doc) return false;
  if (user.username !== doc.requestedBy) return false;
  return doc.status === "Pending";
};

const calculateTravelEstimate = async (origin, destination, routeOptions = {}) => {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();

  let distanceKm = 0;
  let distanceMeters = 0;
  let routeDuration = null;
  let routeDurationText = null;
  let routeAvoidTolls = false;
  let routeAvoidHighways = false;

  try {
    const routeResult = await getDrivingDistance(
      cleanOrigin,
      cleanDestination,
      routeOptions
    );
    distanceKm = Number(routeResult?.distanceKm || 0);
    distanceMeters = Number(routeResult?.distanceMeters || 0);
    routeDuration = routeResult?.duration || null;
    routeDurationText = routeResult?.durationText || null;
    routeAvoidTolls = routeResult?.avoidTolls;
    routeAvoidHighways = routeResult?.avoidHighways;
  } catch (routeError) {
    console.error("Route calculation failed:", routeError.message);
  }

  const ratePerKm = Number(process.env.TRAVEL_RATE_PER_KM || 0);
  const amount = Number((distanceKm * ratePerKm).toFixed(2));

  return {
    cleanOrigin,
    cleanDestination,
    distanceKm,
    distanceMeters,
    routeDuration,
    routeDurationText,
    routeAvoidTolls,
    routeAvoidHighways,
    ratePerKm,
    amount,
  };
};

const uploadTollReceiptToS3 = async (file) => {
  const bucket = process.env.AWS_BUCKET;
  const folder =
    process.env.AWS_TRAVEL_EXPENSE_FOLDER ||
    process.env.AWS_RECEIPT_FOLDER ||
    "receipts";

  if (!bucket || !process.env.AWS_REGION) {
    throw new Error("S3 configuration is incomplete");
  }

  return uploadBufferToS3({
    bucket,
    folder,
    fileName: file.originalname,
    buffer: file.buffer,
    contentType: file.mimetype,
  });
};

exports.estimateTravelExpense = async (req, res) => {
  try {
    const {
      origin,
      destination,
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    } = req.body;

    if (!origin?.trim()) {
      return res.status(400).json({ message: "Origin is required" });
    }

    if (!destination?.trim()) {
      return res.status(400).json({ message: "Destination is required" });
    }

    const estimate = await calculateTravelEstimate(origin, destination, {
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    });

    return res.status(200).json({
      message: "Travel estimate calculated successfully",
      data: {
        origin: estimate.cleanOrigin,
        destination: estimate.cleanDestination,
        distanceKm: estimate.distanceKm,
        estimatedAmount: estimate.amount,
      },
      routeMeta: {
        distanceMeters: estimate.distanceMeters,
        distanceKm: estimate.distanceKm,
        duration: estimate.routeDurationText || estimate.routeDuration,
        durationSeconds: estimate.routeDuration,
        avoidTolls: estimate.routeAvoidTolls,
        avoidHighways: estimate.routeAvoidHighways,
        ratePerKm: estimate.ratePerKm,
      },
    });
  } catch (error) {
    console.error("estimateTravelExpense error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.createTravelExpense = async (req, res) => {
  try {
    const {
      origin,
      destination,
      departureDateTime,
      note = "",
      tollFee,
      quotationId,
      quotationNumber,
      quotationTitle,
      projectName,
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    } = req.body;

    if (!origin?.trim()) {
      return res.status(400).json({ message: "Origin is required" });
    }

    if (!destination?.trim()) {
      return res.status(400).json({ message: "Destination is required" });
    }

    if (!departureDateTime) {
      return res
        .status(400)
        .json({ message: "Departure date time is required" });
    }

    const user = req.user;
    if (!user?.username) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const estimate = await calculateTravelEstimate(origin, destination, {
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    });
    const uploadedReceipts = await Promise.all(
      (req.files || []).map(uploadTollReceiptToS3)
    );
    const tollReceiptUrls = uploadedReceipts.map((file) => file.url);
    const quotationSnapshot = await resolveQuotationPayload({
      quotationId,
      quotationNumber,
      quotationTitle,
      projectName,
    });

    const doc = await TravelExpense.create({
      origin: estimate.cleanOrigin,
      destination: estimate.cleanDestination,
      departureDateTime,
      transportationType: "Car",
      distanceKm: estimate.distanceKm,
      amount: estimate.amount,
      tollFee: parseMoneyValue(tollFee),
      note: note?.trim() || "",
      requestedBy: user.username,
      requestedByLevel: Number(user.level) || 1,
      ...quotationSnapshot,
      department: user.department || "",
      team: user.team || "",
      teamGroup: user.teamGroup || "",
      receiptUrl: tollReceiptUrls[0] || "",
      tollReceiptUrls,
      approvalSteps: createApprovalSteps(user.level),
      currentApprovalLevel: buildApprovalLevels(user.level)[0] || null,
    });

    return res.status(201).json({
      message: "Travel expense created successfully",
      data: doc,
      routeMeta: {
        distanceMeters: estimate.distanceMeters,
        distanceKm: estimate.distanceKm,
        duration: estimate.routeDurationText || estimate.routeDuration,
        durationSeconds: estimate.routeDuration,
        avoidTolls: estimate.routeAvoidTolls,
        avoidHighways: estimate.routeAvoidHighways,
        ratePerKm: estimate.ratePerKm,
      },
    });
  } catch (error) {
    console.error("createTravelExpense error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.updateTravelExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const doc = await TravelExpense.findById(id);

    if (!doc) {
      return res.status(404).json({ message: "Travel expense not found" });
    }

    if (!canManageOwnPendingTravelExpense(user, doc)) {
      return res.status(403).json({
        message: "You do not have permission to edit this item",
      });
    }

    const {
      origin,
      destination,
      departureDateTime,
      note,
      tollFee,
      quotationId,
      quotationNumber,
      quotationTitle,
      projectName,
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    } = req.body;

    const nextOrigin = origin?.trim() || doc.origin;
    const nextDestination = destination?.trim() || doc.destination;
    const nextDepartureDateTime = departureDateTime || doc.departureDateTime;

    if (!nextOrigin) {
      return res.status(400).json({ message: "Origin is required" });
    }

    if (!nextDestination) {
      return res.status(400).json({ message: "Destination is required" });
    }

    if (!nextDepartureDateTime) {
      return res
        .status(400)
        .json({ message: "Departure date time is required" });
    }

    const estimate = await calculateTravelEstimate(nextOrigin, nextDestination, {
      avoidTolls,
      avoidHighways,
      useExpressway,
      useTolls,
    });

    const hasQuotationPayload =
      quotationId !== undefined ||
      quotationNumber !== undefined ||
      quotationTitle !== undefined ||
      projectName !== undefined;

    const quotationSnapshot = hasQuotationPayload
      ? await resolveQuotationPayload({
          quotationId,
          quotationNumber,
          quotationTitle,
          projectName,
        })
      : {
          quotationId: doc.quotationId || null,
          quotationNumber: doc.quotationNumber || "",
          quotationTitle: doc.quotationTitle || "",
          projectName: doc.projectName || "",
        };

    const uploadedReceipts = await Promise.all(
      (req.files || []).map(uploadTollReceiptToS3)
    );
    const tollReceiptUrls =
      uploadedReceipts.length > 0
        ? uploadedReceipts.map((file) => file.url)
        : doc.tollReceiptUrls || [];

    doc.origin = estimate.cleanOrigin;
    doc.destination = estimate.cleanDestination;
    doc.departureDateTime = nextDepartureDateTime;
    doc.distanceKm = estimate.distanceKm;
    doc.amount = estimate.amount;
    doc.tollFee =
      tollFee !== undefined ? parseMoneyValue(tollFee) : doc.tollFee;
    doc.note = note !== undefined ? note?.trim() || "" : doc.note;
    doc.quotationId = quotationSnapshot.quotationId;
    doc.quotationNumber = quotationSnapshot.quotationNumber;
    doc.quotationTitle = quotationSnapshot.quotationTitle;
    doc.projectName = quotationSnapshot.projectName;
    doc.receiptUrl = tollReceiptUrls[0] || "";
    doc.tollReceiptUrls = tollReceiptUrls;

    resetTravelExpenseApprovalFlow(doc);

    await doc.save();

    return res.status(200).json({
      message: "Travel expense updated successfully",
      data: doc,
      routeMeta: {
        distanceMeters: estimate.distanceMeters,
        distanceKm: estimate.distanceKm,
        duration: estimate.routeDurationText || estimate.routeDuration,
        durationSeconds: estimate.routeDuration,
        avoidTolls: estimate.routeAvoidTolls,
        avoidHighways: estimate.routeAvoidHighways,
        ratePerKm: estimate.ratePerKm,
      },
    });
  } catch (error) {
    console.error("updateTravelExpense error:", error);
    return res.status(error.statusCode || 500).json({ message: error.message });
  }
};

exports.deleteTravelExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const doc = await TravelExpense.findById(id);

    if (!doc) {
      return res.status(404).json({ message: "Travel expense not found" });
    }

    if (!canManageOwnPendingTravelExpense(user, doc)) {
      return res.status(403).json({
        message: "You do not have permission to delete this item",
      });
    }

    await TravelExpense.deleteOne({ _id: doc._id });

    return res.status(200).json({
      message: "Travel expense deleted successfully",
    });
  } catch (error) {
    console.error("deleteTravelExpense error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.getTravelExpenses = async (req, res) => {
  try {
    const user = req.user;
    const { status, year, page = 1, limit = 10, search = "" } = req.query;

    const query = {};

    if (year) {
      const start = new Date(`${year}-01-01T00:00:00.000Z`);
      const end = new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`);
      query.departureDateTime = { $gte: start, $lt: end };
    }

    if (status && status !== "All") {
      query.status = status;
    }

    if (search?.trim()) {
      query.$or = [
        { origin: { $regex: search, $options: "i" } },
        { destination: { $regex: search, $options: "i" } },
        { requestedBy: { $regex: search, $options: "i" } },
      ];
    }

    if (user.role !== "admin") {
      query.requestedBy = user.username;
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [data, total] = await Promise.all([
      TravelExpense.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      TravelExpense.countDocuments(query),
    ]);

    return res.status(200).json({
      data,
      total,
      currentPage: Number(page),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error("getTravelExpenses error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.approveTravelExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;

    const doc = await TravelExpense.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Travel expense not found" });
    }

    await ensureApprovalFlow(doc);

    if (!canApproveTravelExpense(user, doc)) {
      return res.status(403).json({
        message: "You do not have permission to approve this item",
      });
    }

    if (doc.status !== "Pending") {
      return res.status(400).json({
        message: "This item is not pending anymore",
      });
    }

    const currentStep = syncCurrentApprovalLevel(doc);
    if (!currentStep) {
      return res.status(400).json({
        message: "No pending approval step found",
      });
    }

    currentStep.status = "Approved";
    currentStep.actedBy = user.username;
    currentStep.actedAt = new Date();
    currentStep.rejectedReason = "";

    const nextStep = getCurrentApprovalStep(doc);

    if (nextStep) {
      doc.currentApprovalLevel = Number(nextStep.level);
      doc.approvedBy = "";
      doc.approvedAt = null;
      doc.rejectedReason = "";
    } else {
      doc.status = "Approved";
      doc.currentApprovalLevel = null;
      doc.approvedBy = user.username;
      doc.approvedAt = new Date();
      doc.rejectedReason = "";
    }

    await doc.save();

    return res.status(200).json({
      message: "Approved successfully",
      data: doc,
    });
  } catch (error) {
    console.error("approveTravelExpense error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.rejectTravelExpense = async (req, res) => {
  try {
    const { id } = req.params;
    const { rejectedReason = "" } = req.body;
    const user = req.user;

    const doc = await TravelExpense.findById(id);
    if (!doc) {
      return res.status(404).json({ message: "Travel expense not found" });
    }

    await ensureApprovalFlow(doc);

    if (!canApproveTravelExpense(user, doc)) {
      return res.status(403).json({
        message: "You do not have permission to reject this item",
      });
    }

    if (doc.status !== "Pending") {
      return res.status(400).json({
        message: "This item is not pending anymore",
      });
    }

    const currentStep = syncCurrentApprovalLevel(doc);
    if (!currentStep) {
      return res.status(400).json({
        message: "No pending approval step found",
      });
    }

    currentStep.status = "Rejected";
    currentStep.actedBy = user.username;
    currentStep.actedAt = new Date();
    currentStep.rejectedReason = rejectedReason;

    doc.status = "Rejected";
    doc.approvedBy = user.username;
    doc.approvedAt = new Date();
    doc.rejectedReason = rejectedReason;
    doc.currentApprovalLevel = null;

    await doc.save();

    return res.status(200).json({
      message: "Rejected successfully",
      data: doc,
    });
  } catch (error) {
    console.error("rejectTravelExpense error:", error);
    return res.status(500).json({ message: error.message });
  }
};

exports.getTravelExpenseApprovals = async (req, res) => {
  try {
    const { status = "Pending", year, search = "" } = req.query;
    const user = req.user;

    const query = {};

    if (year) {
      const start = new Date(`${year}-01-01T00:00:00.000Z`);
      const end = new Date(`${Number(year) + 1}-01-01T00:00:00.000Z`);
      query.departureDateTime = { $gte: start, $lt: end };
    }

    if (status !== "All") {
      query.status = status;
    }

    if (search.trim()) {
      query.$or = [
        { origin: { $regex: search, $options: "i" } },
        { destination: { $regex: search, $options: "i" } },
        { requestedBy: { $regex: search, $options: "i" } },
      ];
    }

    if (user.role === "admin") {
    } else {
      query.requestedBy = { $ne: user.username };
      if (Number(user.level) < 3) {
        return res.status(403).json({ message: "No approval permission" });
      }

      if (Number(user.level) !== 4) {
        query.department = user.department;
      }

      query.status = "Pending";
    }

    const docs = await TravelExpense.find(query).sort({ createdAt: -1 });
    await Promise.all(docs.map((doc) => ensureApprovalFlow(doc)));

    const data =
      user.role === "admin"
        ? docs
        : docs.filter((doc) => {
            const currentStep = syncCurrentApprovalLevel(doc);

            return (
              !!currentStep &&
              Number(currentStep.level) === Number(user.level) &&
              isSameApprovalScope(user, doc)
            );
          });

    return res.status(200).json({ data });
  } catch (error) {
    console.error("getTravelExpenseApprovals error:", error);
    return res.status(500).json({ message: error.message });
  }
};
