// middlewares/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const ALLOWED_COMPANIES = new Set(["OPTX", "NEONWORKS", "NEON", "OPTXFI"]); 
// ปรับตามค่าที่คุณเก็บจริงใน user.company

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // console.log("decoded =>" , decoded);
    

    // ✅ (แนะนำ) ตรวจ company ใน token ถ้ามี เพื่อกัน token แปลกๆ
    if (decoded.company) {
      const c = String(decoded.company).toUpperCase();
      if (!ALLOWED_COMPANIES.has(c)) {
        return res.status(403).json({ message: "Forbidden: company not allowed" });
      }
    }

    let user = null;

    // 1) หา by userId ก่อน
    if (decoded.userId) {
      user = await User.findById(decoded.userId).select("-password");
    }

    // 2) ถ้าไม่เจอ → fallback หา username
    if (!user && decoded.username) {
      user = await User.findOne({ username: decoded.username }).select("-password");
    }

    // 3) ถ้ายังไม่เจอ → fallback email
    if (!user && decoded.email) {
      user = await User.findOne({ email: decoded.email }).select("-password");
    }

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

module.exports = authMiddleware;
