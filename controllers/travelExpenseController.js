const TravelExpense = require("../models/TravelExpense");
const { getDrivingDistance } = require("../services/googleRoutesService");
const { uploadBufferToS3 } = require("../utils/s3Client");

const canApproveTravelExpense = (user, doc) => {
  if (!user || !doc) return false;

  if (user.role === "admin") return true;
  if (user.username === doc.requestedBy) return false;

  if (Number(user.level) >= 3) {
    return !!user.department && user.department === doc.department;
  }

  if (Number(user.level) === 2) {
    return !!user.teamGroup && user.teamGroup === doc.teamGroup;
  }

  return false;
};

const calculateTravelEstimate = async (origin, destination) => {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();

  let distanceKm = 0;
  let distanceMeters = 0;
  let routeDuration = null;

  try {
    const routeResult = await getDrivingDistance(cleanOrigin, cleanDestination);
    distanceKm = Number(routeResult?.distanceKm || 0);
    distanceMeters = Number(routeResult?.distanceMeters || 0);
    routeDuration = routeResult?.duration || null;
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
    const { origin, destination } = req.body;

    if (!origin?.trim()) {
      return res.status(400).json({ message: "Origin is required" });
    }

    if (!destination?.trim()) {
      return res.status(400).json({ message: "Destination is required" });
    }

    const estimate = await calculateTravelEstimate(origin, destination);

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
        duration: estimate.routeDuration,
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
    const { origin, destination, departureDateTime, note = "" } = req.body;

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

    const estimate = await calculateTravelEstimate(origin, destination);
    const uploadedReceipts = await Promise.all(
      (req.files || []).map(uploadTollReceiptToS3)
    );
    const tollReceiptUrls = uploadedReceipts.map((file) => file.url);

    const doc = await TravelExpense.create({
      origin: estimate.cleanOrigin,
      destination: estimate.cleanDestination,
      departureDateTime,
      transportationType: "Car",
      distanceKm: estimate.distanceKm,
      amount: estimate.amount,
      note: note?.trim() || "",
      requestedBy: user.username,
      department: user.department || "",
      team: user.team || "",
      teamGroup: user.teamGroup || "",
      receiptUrl: tollReceiptUrls[0] || "",
      tollReceiptUrls,
    });

    return res.status(201).json({
      message: "Travel expense created successfully",
      data: doc,
      routeMeta: {
        distanceMeters: estimate.distanceMeters,
        distanceKm: estimate.distanceKm,
        duration: estimate.routeDuration,
        ratePerKm: estimate.ratePerKm,
      },
    });
  } catch (error) {
    console.error("createTravelExpense error:", error);
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

    doc.status = "Approved";
    doc.approvedBy = user.username;
    doc.approvedAt = new Date();
    doc.rejectedReason = "";

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

    doc.status = "Rejected";
    doc.approvedBy = user.username;
    doc.approvedAt = new Date();
    doc.rejectedReason = rejectedReason;

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

      if (Number(user.level) >= 3) {
        query.department = user.department;
      } else if (Number(user.level) === 2) {
        query.teamGroup = user.teamGroup;
      } else {
        return res.status(403).json({ message: "No approval permission" });
      }
    }

    const data = await TravelExpense.find(query).sort({ createdAt: -1 });

    return res.status(200).json({ data });
  } catch (error) {
    console.error("getTravelExpenseApprovals error:", error);
    return res.status(500).json({ message: error.message });
  }
};
