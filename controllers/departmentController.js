const Department = require("../models/Department");

// 🔹 ดึงทั้งหมด
exports.getAllDepartments = async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 });
    res.status(200).json(departments);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 สร้างใหม่
exports.createDepartment = async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: "Name is required" });

    const exists = await Department.findOne({ name });
    if (exists) return res.status(400).json({ message: "Department already exists" });

    const department = new Department({ name });
    await department.save();
    res.status(201).json(department);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 อัปเดตชื่อ
exports.updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const department = await Department.findById(id);
    if (!department) return res.status(404).json({ message: "Department not found" });

    department.name = name;
    await department.save();

    res.status(200).json(department);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
