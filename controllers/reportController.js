// controllers/reportController.js
const mongoose = require("mongoose");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Client = require("../models/Client"); // ✅ เพิ่ม model

exports.getDepartmentSpending = async (req, res) => {
  try {
    const { email, level, role, team } = req.user;
    const { year, clientIds } = req.query;
    const selectedYear = year ? parseInt(year) : new Date().getFullYear();

    const matchConditions = [
      {
        $or: [
          { documentYear: selectedYear },
          { documentYear: selectedYear.toString() },
          {
            documentDate: {
              $gte: new Date(`${selectedYear}-01-01T00:00:00Z`),
              $lte: new Date(`${selectedYear}-12-31T23:59:59Z`),
            },
          },
        ],
      },
    ];

    let clientArray = [];
    if (clientIds) {
      clientArray = Array.isArray(clientIds)
        ? clientIds
        : clientIds.split(",").map((id) => id.trim());

      // ✅ แปลงเป็น ObjectId เฉพาะที่ valid
      const objectIds = clientArray
        .filter((id) => mongoose.Types.ObjectId.isValid(id))
        .map((id) => new mongoose.Types.ObjectId(id));

      matchConditions.push({
        clientId: { $in: objectIds },
      });
    }

    // ✅ จำกัดทีม (เฉพาะ user ระดับต่ำกว่า admin)
    if (role !== "admin" && level < 3) {
      const usersInTeam = await User.find({ team }).select("email");
      const allowedEmails = usersInTeam.map((u) => u.email);
      matchConditions.push({ createdByUser: { $in: allowedEmails } });
    }

    const matchStage = { $and: matchConditions };
    console.log("🟢 matchStage:", JSON.stringify(matchStage, null, 2));

    // ✅ Aggregate pipeline แยกยอดตาม department
    const quotations = await Quotation.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$department",
          totalSpending: { $sum: "$netAmount" },
          quotationCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpending: -1 } },
    ]);

    const grandTotal = quotations.reduce(
      (sum, dept) => sum + dept.totalSpending,
      0
    );

    // ✅ ดึงชื่อ client ทั้งหมดที่ส่งมา
    let clientDetails = [];
    if (clientArray.length > 0) {
      clientDetails = await Client.find(
        { _id: { $in: clientArray } },
        "_id companyBaseName"
      ).lean();
    }

    // ✅ Response
    res.status(200).json({
      success: true,
      year: selectedYear,
      filterClients: clientDetails.map((c) => ({
        _id: c._id,
        companyBaseName: c.companyBaseName || "Unknown",
      })),
      grandTotal,
      departments: quotations.map((d) => ({
        department: d._id || "Unknown",
        totalSpending: d.totalSpending,
        quotationCount: d.quotationCount,
      })),
    });
  } catch (error) {
    console.error("❌ Error fetching department spending:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
