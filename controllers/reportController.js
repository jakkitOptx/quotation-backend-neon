// controllers/reportController.js
const mongoose = require("mongoose");
const Quotation = require("../models/Quotation");
const User = require("../models/User");
const Client = require("../models/Client");

exports.getDepartmentSpending = async (req, res) => {
  try {
    const { email, level, role, team } = req.user;
    const { year, clientIds, useBeforeVat } = req.query;

    const selectedYear = year ? parseInt(year) : new Date().getFullYear();

    // ---------------------------------------------------------
    // 👉 ใช้ total เมื่อเลือกใช้ยอดก่อน VAT
    // ---------------------------------------------------------
    const useBeforeVatFlag = useBeforeVat === "true";
    const spendingField = useBeforeVatFlag ? "$total" : "$netAmount";

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

      // 🔥 รองรับ 2 โครงสร้าง clientId
      matchConditions.push({
        $expr: {
          $or: [
            { $in: [{ $toString: "$clientId" }, clientArray] },
            { $in: [{ $toString: "$clientId._id" }, clientArray] },
          ],
        },
      });
    }

    // จำกัดการดูตามทีม ถ้าไม่ใช่ admin
    if (role !== "admin" && level < 3) {
      const usersInTeam = await User.find({ team }).select("email");
      const allowedEmails = usersInTeam.map((u) => u.email);
      matchConditions.push({ createdByUser: { $in: allowedEmails } });
    }

    const matchStage = { $and: matchConditions };

    // ---------------------------------------------------------
    // 👉 Aggregate โดยใช้ spendingField ที่ตั้งไว้ด้านบน
    // ---------------------------------------------------------
    const quotations = await Quotation.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$department",
          totalSpending: { $sum: spendingField },
          quotationCount: { $sum: 1 },
        },
      },
      { $sort: { totalSpending: -1 } },
    ]);

    const grandTotal = quotations.reduce(
      (sum, dept) => sum + dept.totalSpending,
      0
    );

    // ดึงชื่อบริษัทลูกค้า
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
      useBeforeVat: useBeforeVatFlag, // ส่งกลับไปให้ frontend รับรู้ด้วย
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
