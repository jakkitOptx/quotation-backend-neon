// controllers/travelExpenseController.js
const TravelExpense = require("../models/TravelExpense");

exports.createTravelExpense = async (req, res) => {
  try {
    const {
      origin,
      destination,
      departureDateTime,
      transportationType,
      amount,
      note = "",
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

    const doc = await TravelExpense.create({
      origin: origin.trim(),
      destination: destination.trim(),
      departureDateTime,
      transportationType,
      amount: Number(amount || 0),
      note: note?.trim() || "",
      requestedBy: user.username,
      department: user.department || "",
      team: user.team || "",
      teamGroup: user.teamGroup || "",
    });

    return res.status(201).json(doc);
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

    // ปรับ logic permission ตามระบบคุณได้
    if (user.role !== "admin") {
      if (user.level >= 3) {
        query.department = user.department;
      } else if (user.level === 2) {
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
