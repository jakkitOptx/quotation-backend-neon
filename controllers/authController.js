// authController.js
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const User = require("../models/User");
const nodemailer = require("nodemailer");
const connectDB = require("../config/db");

// ลงทะเบียน (Register)
exports.register = async (req, res) => {
  try {
    await connectDB(); // ✅ เพิ่มเพื่อกัน buffering timed out / cold start

    let users = req.body;
    if (!Array.isArray(users)) {
      users = [users]; // ถ้าเป็น object เดียว ให้แปลงเป็น array
    }

    // ค้นหาว่ามี username ไหนที่ซ้ำกันบ้างก่อนจะ insert
    const existingUsersInDB = await User.find({
      username: { $in: users.map((u) => u.username) },
    });
    const existingUsernames = existingUsersInDB.map((user) => user.username);

    // กรองเฉพาะผู้ใช้ใหม่ที่ยังไม่อยู่ในระบบ และแฮช password
    const usersToInsert = await Promise.all(
      users
        .filter((user) => !existingUsernames.includes(user.username))
        .map(async (userData) => {
          const {
            firstName,
            lastName,
            nickname,
            username,
            password,
            level,
            department,
            position,
            role,
          } = userData;

          // ดึง domain จาก username และแปลงเป็น company
          const domain = username.split("@")[1]?.split(".")[0];
          const company =
            domain === "neonworks"
              ? "Neon"
              : domain === "optx"
              ? "Optx"
              : "Unknown";

          // ตรวจสอบ role ว่าถูกต้องหรือไม่
          const assignedRole =
            role && ["admin", "manager", "user"].includes(role.toLowerCase())
              ? role.toLowerCase()
              : "user";

          // ✅ แฮชรหัสผ่านก่อนบันทึก
          const hashedPassword = await bcrypt.hash(password, 10);

          return {
            firstName,
            lastName,
            nickname: nickname || "",
            username,
            password: hashedPassword, // ✅ บันทึก password แบบเข้ารหัส
            level: level || 1,
            company,
            department: department || "N/A",
            position: position || "N/A",
            role: assignedRole,
            flow: null,
          };
        })
    );

    // ถ้าไม่มีผู้ใช้ใหม่เลย
    if (usersToInsert.length === 0) {
      return res.status(400).json({
        message: "All provided emails already exist",
        existingUsers: existingUsernames,
      });
    }

    // ✅ ใช้ insertMany() เพื่อบันทึกทีเดียว
    const insertedUsers = await User.insertMany(usersToInsert);

    // ✅ สร้าง JWT Token สำหรับทุกคนที่สมัครใหม่
    const tokens = insertedUsers.map((user) =>
      jwt.sign(
        {
          userId: user._id,
          username: user.username,
          level: user.level,
          company: user.company,
          role: user.role,
        },
        process.env.JWT_SECRET,
        { expiresIn: "3h" }
      )
    );

    res.status(201).json({
      message: "Users registered successfully",
      users: insertedUsers.map((user) => ({
        _id: user._id, // ✅ เพิ่มตรงนี้
        firstName: user.firstName,
        lastName: user.lastName,
        nickname: user.nickname,
        username: user.username,
        level: user.level,
        company: user.company,
        department: user.department,
        position: user.position,
        role: user.role,
        flow: user.flow,
      })),
      tokens,
      existingUsers:
        existingUsernames.length > 0 ? existingUsernames : undefined,
    });
  } catch (error) {
    console.error("❌ Error registering users:", error);
    res.status(500).json({ message: error.message });
  }
};

// เข้าสู่ระบบ (Login)
exports.login = async (req, res) => {
  const { username, password } = req.body;
  try {
    await connectDB(); // ✅ เพิ่มบรรทัดนี้เท่านั้น

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (process.env.NODE_ENV === "development") {
      console.log("🔹 Login attempt for:", username);
    }

    const isMatch = await bcrypt.compare(password, user.password);
    console.log("🔹 Password Match:", isMatch);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const token = jwt.sign(
      {
        userId: user._id,
        username: user.username,
        nickname: user.nickname,
        level: user.level,
        company: user.company,
        role: user.role,
        department: user.department,
        position: user.position,
        flow: user.flow,
        team: user.team,
        teamGroup: user.teamGroup,
        teamRole: user.teamRole,
      },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.status(200).json({
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        nickname: user.nickname,
        username: user.username,
        level: user.level,
        company: user.company,
        department: user.department,
        position: user.position,
        role: user.role,
        flow: user.flow,
        team: user.team,
        teamGroup: user.teamGroup,
        teamRole: user.teamRole,
      },
      expiresIn: 12 * 60 * 60,
    });
  } catch (error) {
    console.error("❌ Login Error:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

// ขอรีเซ็ตรหัสผ่าน (Request Reset Password)
exports.requestPasswordReset = async (req, res) => {
  const { username } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ สร้าง Reset Token
    const resetToken = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    user.resetToken = resetToken;
    user.resetTokenExpiry = Date.now() + 3600000; // 1 ชั่วโมง

    await user.save();

    // ✅ ตั้งค่า Nodemailer ให้ใช้ Google SMTP
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS, // ใช้ App Password
      },
    });

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    const mailOptions = {
      from: `"Support Team" <${process.env.SMTP_USER}>`,
      to: user.username,
      subject: "Password Reset Request",
      html: `
        <h2>Password Reset Request</h2>
        <p>Click the link below to reset your password:</p>
        <a href="${resetUrl}">${resetUrl}</a>
        <p>This link will expire in 1 hour.</p>
      `,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      message: "Password reset link has been sent to your email",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// รีเซ็ตรหัสผ่าน (Reset Password)
exports.resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body;

  try {
    // ✅ ตรวจสอบ token และค้นหา user
    const decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    if (
      !user ||
      user.resetToken !== resetToken ||
      user.resetTokenExpiry < Date.now()
    ) {
      return res
        .status(400)
        .json({ message: "Invalid or expired reset token" });
    }

    // ✅ แฮชรหัสผ่านใหม่
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);

    // ✅ ล้างค่า resetToken
    user.resetToken = undefined;
    user.resetTokenExpiry = undefined;

    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    res.status(400).json({ message: "Invalid or expired reset token" });
  }
};
