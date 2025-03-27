// userController.js
const User = require("../models/User");

// ✅ ดึงรายชื่อผู้ใช้ทั้งหมด
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({}, "firstName lastName username level company department position flow role");

    const usersWithCompany = users.map((user) => {
      const domain = user.username.split("@")[1]?.split(".")[0];
      const company =
        domain === "neonworks" ? "Neon" : domain === "optx" ? "Optx" : "Unknown";

      return {
        ...user._doc,
        company,
      };
    });

    res.status(200).json(usersWithCompany);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ ดึงข้อมูลผู้ใช้รายบุคคลโดยใช้ ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id, "firstName lastName username level company department position flow role");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const domain = user.username.split("@")[1]?.split(".")[0];
    const company =
      domain === "neonworks" ? "Neon" : domain === "optx" ? "Optx" : "Unknown";

    res.status(200).json({ ...user._doc, company });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ✅ อัปเดตข้อมูลส่วนตัวของผู้ใช้
// แก้ไขข้อมูลส่วนตัวของผู้ใช้
exports.updateUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { firstName, lastName, username, password, department, position, flow, role } = req.body;

    // ค้นหาผู้ใช้ตาม ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // ป้องกันการเปลี่ยน Level ผ่าน API นี้
    if (req.body.level) {
      return res.status(403).json({ message: 'Permission denied to change level' });
    }

    // Validate username ให้เป็น Email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (username && !emailRegex.test(username)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // อัปเดตฟิลด์ที่ส่งมาในคำขอ
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (username) user.username = username;
    if (password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(password, salt);
    }
    if (department !== undefined) user.department = department;
    if (position !== undefined) user.position = position;
    if (flow !== undefined) user.flow = flow;
    if (role) user.role = role;

    await user.save();
    res.status(200).json({ message: 'User profile updated successfully', user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

