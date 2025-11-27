// controllers/reportController.js
const mongoose = require("mongoose");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Client = require("../models/Client");

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

      // 🔥 รองรับ 2 โครงสร้างของ clientId
      matchConditions.push({
        $expr: {
          $or: [
            { $in: [ { $toString: "$clientId" }, clientArray ] },      // ObjectId แบบเดี่ยว
            { $in: [ { $toString: "$clientId._id" }, clientArray ] },  // embedded object
          ]
        }
      });
    }

    // จำกัดตามทีม
    if (role !== "admin" && level < 3) {
      const usersInTeam = await User.find({ team }).select("email");
      const allowedEmails = usersInTeam.map((u) => u.email);
      matchConditions.push({ createdByUser: { $in: allowedEmails } });
    }

    const matchStage = { $and: matchConditions };

    // Aggregate
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

    // ดึง client ชื่อจริง
    let clientDetails = [];
    if (clientArray.length > 0) {
      clientDetails = await Client.find(
        { _id: { $in: clientArray } },
        "_id companyBaseName"
      ).lean();
    }

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
