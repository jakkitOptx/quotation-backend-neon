const Log = require("../models/Log");

// ✅ get all logs (with optional date filter)
exports.getAllLogs = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    // สร้าง filter object
    const filter = {};

    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) {
        filter.timestamp.$gte = new Date(startDate); // >= startDate
      }
      if (endDate) {
        // set เวลาเป็นสิ้นสุดวัน เพื่อครอบคลุม log ทั้งวัน
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        filter.timestamp.$lte = end; // <= endDate
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

// ✅ create a log (manual)
exports.createLog = async (req, res) => {
  try {
    const { quotationId, action, performedBy, description } = req.body;
    const newLog = new Log({
      quotationId,
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
