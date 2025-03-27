// authMiddleware.js
const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization; // ตรวจสอบ Authorization Header
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized' }); // ไม่มี Token หรือไม่ถูกต้อง
  }

  const token = authHeader.split(' ')[1]; // แยก Bearer และ Token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // ตรวจสอบความถูกต้องของ Token
    req.userId = decoded.userId; // เพิ่ม userId ใน Request Object
    next(); // ดำเนินการต่อไป
  } catch (error) {
    res.status(403).json({ message: 'Forbidden: Invalid token' }); // Token ไม่ถูกต้อง
  }
};

module.exports = authMiddleware;
