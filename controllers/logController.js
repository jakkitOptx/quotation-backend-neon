const Log = require("../models/Log");

// ✅ get all logs
exports.getAllLogs = async (req, res) => {
  try {
    const logs = await Log.find().sort({ timestamp: -1 });
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ get logs by quotationId
exports.getLogsByQuotation = async (req, res) => {
  try {
    const { quotationId } = req.params;
    const logs = await Log.find({ quotationId })
      .sort({ timestamp: -1 })
      .exec();
    res.status(200).json(logs);
  } catch (err) {
    console.error("Error getting logs by quotation:", err);
    res.status(500).json({ message: err.message });
  }
};

// ✅ create a log (optional ใช้กรณี manual)
exports.createLog = async (req, res) => {
  try {
    const { quotationId, action, performedBy, description } = req.body;
    const newLog = new Log({
      quotationId,
      action,
      performedBy,
      description
    });
    await newLog.save();
    res.status(201).json(newLog);
  } catch (err) {
    console.error("Error creating log:", err);
    res.status(500).json({ message: err.message });
  }
};
