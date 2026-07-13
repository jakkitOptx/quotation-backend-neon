// User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const UserSchema = new mongoose.Schema({
  firstName: { type: String, required: true },
  lastName: { type: String, required: true },
  nickname: { type: String, default: "" },
  username: { type: String, required: true, unique: true }, // ใช้ username เป็น email
  password: { type: String, required: true },
  level: { type: Number, default: 1 }, // Default level เป็น 1
  company: { type: String },
  department: { type: String, default: "" },
  position: { type: String, default: "" },
  flow: { type: mongoose.Schema.Types.ObjectId, ref: "ApprovalFlow", default: null },
  team: { type: String, default: "" }, // เช่น AE1, AE2, SoSparkKOLs1
  teamGroup: { type: String, default: "" }, // เช่น AE, Vertix, SoSpark, Media
  teamRole: { type: String, enum: ["member", "head","groupHead"], default: "member" },
  role: {
    type: String,
    enum: ["admin", "manager", "user", "finance"], // ✅ เพิ่ม role finance
    default: "user"
  },
  resetToken: { type: String, default: null },
  resetTokenExpiry: { type: Date, default: null },
});

// แฮชรหัสผ่านก่อนบันทึก
UserSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();

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
