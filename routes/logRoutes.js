const express = require("express");
const router = express.Router();
const logController = require("../controllers/logController");

// get all logs
router.get("/", logController.getAllLogs);

// get logs by quotationId
router.get("/:quotationId", logController.getLogsByQuotation);

// create log (manual)
router.post("/", logController.createLog);

module.exports = router;
