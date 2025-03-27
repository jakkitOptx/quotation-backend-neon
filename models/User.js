// User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  username: { type: String, required: true, unique: true }, // ใช้ username เป็น email
  password: { type: String, required: true },
  level: { type: Number, default: 1 }, // Default level เป็น 1
  company: { type: String }, // เก็บชื่อบริษัท
  department: { type: String, default: "" }, // แผนก
  position: { type: String, default: "" }, // ตำแหน่ง
  flow: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalFlow", default: null }, // Flow ID ที่เกี่ยวข้อง
  role: { type: String, enum: ["admin", "manager", "user"], default: "user" }, // เปลี่ยน employee → user
  resetToken: { type: String, default: null }, // 🔹 Token สำหรับรีเซ็ตรหัสผ่าน
  resetTokenExpiry: { type: Date, default: null }, // 🔹 เวลาหมดอายุของ token
});

// แฮชรหัสผ่านก่อนบันทึก
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next(); // ✅ หยุดถ้า password ไม่เปลี่ยน

  // ✅ ป้องกันแฮชรหัสผ่านซ้ำ
  if (this.password.startsWith("$2b$")) {
    console.log("🔹 Password already hashed, skipping hash process.");
    return next();
  }

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  console.log("✅ Password hashed before saving:", this.password);
  next();
});
module.exports = mongoose.model('User', UserSchema);
