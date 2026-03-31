const Log = require("../models/Log");
// ✅ get all logs (with optional date filter)
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

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        filter.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

    const logs = await Log.find(filter).sort({ timestamp: -1 });
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs:", err);
    res.status(500).json({ message: err.message });
  }
};
// ✅ get logs by quotationId (with optional date filter)
exports.getLogsByQuotation = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = { quotationId };

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        filter.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

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

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        filter.timestamp.$gte = new Date(startDate);
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end;
      }
    }

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
