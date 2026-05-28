const Log = require("../models/Log");

const getThreeMonthsAgo = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  date.setHours(0, 0, 0, 0);
  return date;
};

const applyTimestampFilter = (filter, startDate, endDate) => {
  filter.timestamp = {};

  if (startDate) {
    filter.timestamp.$gte = new Date(startDate);
  }

  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filter.timestamp.$lte = end;
  }

  if (!startDate && !endDate) {
    filter.timestamp.$gte = getThreeMonthsAgo();
  }
};

// get all logs (defaults to the latest 3 months)
exports.getAllLogs = async (req, res) => {
  try {
    const { startDate, endDate, resourceType, quotationId, travelExpenseId } =
      req.query;

    const filter = {};

    if (resourceType) {
      filter.resourceType = resourceType;
    }

    if (quotationId) {
      filter.quotationId = quotationId;
    }

    if (travelExpenseId) {
      filter.travelExpenseId = travelExpenseId;
    }

    applyTimestampFilter(filter, startDate, endDate);

    const logs = await Log.find(filter).sort({ timestamp: -1 });
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs:", err);
    res.status(500).json({ message: err.message });
  }
};

// get logs by quotationId (defaults to the latest 3 months)
exports.getLogsByQuotation = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = { quotationId };

    applyTimestampFilter(filter, startDate, endDate);

    const logs = await Log.find(filter).sort({ timestamp: -1 }).exec();
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs by quotation:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.getLogsByTravelExpense = async (req, res) => {
  try {
    const { travelExpenseId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = {
      travelExpenseId,
      resourceType: "travel-expense",
    };

    applyTimestampFilter(filter, startDate, endDate);

    const logs = await Log.find(filter).sort({ timestamp: -1 }).exec();
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs by travel expense:", err);
    res.status(500).json({ message: err.message });
  }
};

exports.createLog = async (req, res) => {
  try {
    const {
      quotationId,
      travelExpenseId,
      resourceType,
      action,
      performedBy,
      description,
    } = req.body;

    const newLog = new Log({
      quotationId: quotationId || null,
      travelExpenseId: travelExpenseId || null,
      resourceType:
        resourceType || (travelExpenseId ? "travel-expense" : "quotation"),
      action,
      performedBy,
      description,
    });

    await newLog.save();
    res.status(201).json(newLog);
  } catch (err) {
    console.error("Error creating log:", err);
    res.status(500).json({ message: err.message });
  }
};
