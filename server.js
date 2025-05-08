// server.js
const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");

dotenv.config();

const corsOptions = {
  origin: [
    "http://localhost:3000", // สำหรับพัฒนาในเครื่อง
    "https://budgetboss.netlify.app", // Netlify SIT
    // "https://your-custom-domain.com" // ถ้ามีโดเมนของตัวเอง
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  allowedHeaders: "Origin,X-Requested-With,Content-Type,Accept,Authorization",
};

const app = express();

// Middleware
app.use(express.json()); // สำหรับ parse JSON request body
// app.use(cors()); // สำหรับจัดการ CORS
app.use(cors(corsOptions)); // ✅ ใช้ corsOptions เพื่อกำหนด Origin ที่อนุญาต
app.use(morgan("dev")); // สำหรับ log request (ช่วย debug)


// เชื่อมต่อ MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    connectTimeoutMS: 30000, // ⏳ ถ้าเชื่อมต่อไม่สำเร็จภายใน 30 วินาที ให้ตัดการเชื่อมต่อ
    socketTimeoutMS: 45000, // ⏳ ป้องกัน MongoDB ตัดการเชื่อมต่อเร็วเกินไป
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1); // หากเชื่อมต่อไม่ได้ ให้หยุดการทำงาน
  });

// Routes
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

// Routes
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

// Health Check Endpoint
app.get("/", (req, res) => {
  res.status(200).json({ message: "BudgetBoss API is running!" });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
  });
});

// 404 Error Handler
app.use((req, res, next) => {
  res.status(404).json({ message: "Route not found" });
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
