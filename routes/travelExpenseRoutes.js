const express = require("express");
const router = express.Router();
const multer = require("multer");
const authMiddleware = require("../middlewares/authMiddleware");
const travelExpenseController = require("../controllers/travelExpenseController");

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  "/estimate",
  authMiddleware,
  travelExpenseController.estimateTravelExpense
);
router.post(
  "/",
  authMiddleware,
  upload.array("tollReceipts", 5),
  travelExpenseController.createTravelExpense
);
router.get("/", authMiddleware, travelExpenseController.getTravelExpenses);
router.get("/logs", authMiddleware, travelExpenseController.getTravelExpenseLogs);
router.get("/:id/logs", authMiddleware, travelExpenseController.getTravelExpenseLogsById);
router.get(
  "/approvals",
  authMiddleware,
  travelExpenseController.getTravelExpenseApprovals
);
router.patch(
  "/:id",
  authMiddleware,
  upload.array("tollReceipts", 5),
  travelExpenseController.updateTravelExpense
);
router.patch(
  "/:id/approve",
  authMiddleware,
  travelExpenseController.approveTravelExpense
);
router.patch(
  "/:id/reject",
  authMiddleware,
  travelExpenseController.rejectTravelExpense
);
router.delete("/:id", authMiddleware, travelExpenseController.deleteTravelExpense);

module.exports = router;
