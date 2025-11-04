// controllers/reportController.js
const Quotation = require("../models/Quotation");
const User = require("../models/User");

exports.getDepartmentSpending = async (req, res) => {
  try {
    const { email, level, role, team } = req.user;

    let matchStage = {};

    // ✅ เงื่อนไขกรองตามสิทธิ์
    if (role === "admin" || level >= 3) {
      matchStage = {}; // เห็นทุกแผนก
    } else {
      const usersInTeam = await User.find({ team }).select("email");
      const allowedEmails = usersInTeam.map((u) => u.email);
      matchStage = { createdByUser: { $in: allowedEmails } };
    }

    // ✅ Pipeline: แยกยอดรายแผนก
    const quotations = await Quotation.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),

      // ✅ รวมยอดต่อแผนก
      {
        $group: {
          _id: "$department",
          totalSpending: { $sum: "$netAmount" },
          quotationCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpending: -1 } },
    ]);

    // ✅ รวมยอดรวมทั้งหมด (ทุกแผนกรวมกัน)
    const grandTotal = quotations.reduce(
      (sum, dept) => sum + dept.totalSpending,
      0
    );

    res.status(200).json({
      success: true,
      grandTotal,
      departments: quotations.map((d) => ({
        department: d._id || "Unknown",
        totalSpending: d.totalSpending,
        quotationCount: d.quotationCount,
      })),
    });
  } catch (error) {
    console.error("Error fetching department spending:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
