const express = require("express");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");
const connectDB = require("./config/db");

dotenv.config();

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://neonworksfi.com",
    "https://www.neonworksfi.com",
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
  credentials: true,
  allowedHeaders: "Origin,X-Requested-With,Content-Type,Accept,Authorization",
};

const app = express();
app.use(express.json());

// ✅ CORS + Preflight
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

app.use(morgan("dev"));

/**
 * ✅ สำคัญที่สุด: Ensure DB connected ก่อนเข้า routes ทุกตัว
 * - กัน cold start / race condition บน Vercel
 * - connectDB มี cache อยู่แล้ว → request ต่อๆไปจะเร็วมาก
 */
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    console.error("❌ DB connect error:", err?.message || err);
    return res.status(500).json({ message: "Database connection failed" });
  }
});

// (Optional) จะคงไว้ก็ได้เพื่อ warm-up ตอนเริ่ม function
connectDB()
  .then(() => console.log("✅ MongoDB Connected (warm-up)"))
  .catch((err) => {
    console.error("❌ MongoDB Warm-up Error:", err.message);
  });

// ✅ Routes
const quotationRoutes = require("./routes/quotationRoutes");
const approvalRoutes = require("./routes/approvalRoutes");
const authRoutes = require("./routes/authRoutes");
const userRoutes = require("./routes/userRoutes");
const approvalTemplateRoutes = require("./routes/approvalTemplateRoutes");
const clientRoutes = require("./routes/clientRoutes");
const companyRoutes = require("./routes/companyRoutes");
const driveRoutes = require("./routes/driveRoutes");
const approveFlowRoutes = require("./routes/approveFlowRoutes");
const teamRoutes = require("./routes/teamRoutes");
const departmentRoutes = require("./routes/departmentRoutes");
const logRoutes = require("./routes/logRoutes");
const cronRoutes = require("./routes/cronRoutes");
const fixRoutes = require("./routes/fixRoutes");
const reportRoutes = require("./routes/reportRoutes");
const meetingRoomRoutes = require("./routes/meetingRoomRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const travelExpenseRoutes = require("./routes/travelExpenseRoutes");

app.use("/api/quotations", quotationRoutes);
app.use("/api/approvals", approvalRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/approval-templates", approvalTemplateRoutes);
app.use("/api/clients", clientRoutes);
app.use("/api/companies", companyRoutes);
app.use("/api/drive", driveRoutes);
app.use("/api/approve-flows", approveFlowRoutes);
app.use("/api/teams", teamRoutes);
app.use("/api/departments", departmentRoutes);
app.use("/api/logs", logRoutes);
app.use("/api/cron", cronRoutes);
app.use("/api/fix", fixRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/meeting-rooms", meetingRoomRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/travel-expenses", travelExpenseRoutes);

app.get("/", (req, res) => {
  res.status(200).json({ message: "NEON FINANCE API is running!" });
});

// ✅ Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack || err);
  res
    .status(err.status || 500)
    .json({ message: err.message || "Internal Server Error" });
});

// ✅ 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ✅ Local dev: listen ปกติ / Vercel: export app
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`🚀 API Server running on port ${PORT}`);
  });
}

module.exports = app;


