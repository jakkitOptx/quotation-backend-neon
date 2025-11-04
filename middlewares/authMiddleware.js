// middlewares/authMiddleware.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // ✅ ตรวจว่ามี userId หรือ email ใน payload
    let user;
    if (decoded.userId) {
      user = await User.findById(decoded.userId).select("-password");
    } else if (decoded.email) {
      user = await User.findOne({ email: decoded.email }).select("-password");
    }

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user; // ✅ ผูกข้อมูล user ทั้ง object เข้า req
    next();
  } catch (error) {
    console.error("Auth error:", error);
    res.status(403).json({ message: "Forbidden: Invalid token" });
  }
};

module.exports = authMiddleware;
