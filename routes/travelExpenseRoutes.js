const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const travelExpenseController = require("../controllers/travelExpenseController");

router.post("/", authMiddleware, travelExpenseController.createTravelExpense);
router.get("/", authMiddleware, travelExpenseController.getTravelExpenses);
router.get(
  "/approvals",
  authMiddleware,
  travelExpenseController.getTravelExpenseApprovals
);
router.patch("/:id/approve", authMiddleware, travelExpenseController.approveTravelExpense);
router.patch("/:id/reject", authMiddleware, travelExpenseController.rejectTravelExpense);

module.exports = router;