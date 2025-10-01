// routes/fixRoutes.js
const express = require("express");
const Quotation = require("../models/Quotation");
const Approval = require("../models/Approval");
const router = express.Router();

router.patch("/:id", async (req, res) => {   // ❌ เอา /fix ออก
  try {
    const secret = req.query.secret || req.headers["x-fix-secret"];
    if (!secret || secret !== process.env.FIX_SECRET) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const qt = await Quotation.findById(req.params.id).populate("approvalHierarchy");
    if (!qt) return res.status(404).json({ message: "Quotation not found" });

    const oldApproval = qt.approvalHierarchy[0];
    if (!oldApproval) return res.status(400).json({ message: "No approvalHierarchy found" });

    const newApproval = new Approval({
      quotationId: qt._id,
      approvalHierarchy: oldApproval.approvalHierarchy.map((s) => ({
        approver: s.approver,
        level: s.level,
        status: "Pending",
      })),
    });
    await newApproval.save();

    qt.approvalHierarchy = [newApproval._id];
    qt.approvalStatus = "Pending";
    await qt.save();

    res.json({ message: "Quotation fixed", quotation: qt });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fixing quotation", error: err.message });
  }
});

module.exports = router;
