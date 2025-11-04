const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const cors = require("cors");
const morgan = require("morgan");

dotenv.config();

const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://neonworksfi.com",
  ],
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  credentials: true,
  allowedHeaders: "Origin,X-Requested-With,Content-Type,Accept,Authorization",
};

const app = express();
app.use(express.json());
app.use(cors(corsOptions));
app.use(morgan("dev"));

// ✅ MongoDB
mongoose
  .connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => {
    console.error("❌ MongoDB Error:", err.message);
    process.exit(1);
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

app.get("/", (req, res) => {
    res.status(200).json({ message: "NEON FINANCE API is running!" });
});

// ✅ Error Handler
app.use((err, req, res, next) => {
  console.error("Global Error:", err.stack);
  res.status(err.status || 500).json({ message: err.message || "Internal Server Error" });
});

// ✅ 404 Handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// ✅ เริ่ม server ปกติ
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 API Server running on port ${PORT}`);
});
