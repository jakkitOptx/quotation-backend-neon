const mongoose = require("mongoose");
const Department = require("../models/Department");

const normalizeDetails = (value) => {
  if (!Array.isArray(value)) {
    const error = new TypeError("details must be an array");
    error.status = 400;
    throw error;
  }

  const seen = new Set();

  return value.reduce((details, item) => {
    if (typeof item !== "string") {
      const error = new TypeError("each detail must be a string");
      error.status = 400;
      throw error;
    }

    const name = item.trim().replace(/\s+/g, " ");
    const normalizedName = name.toLowerCase();

    if (!name || seen.has(normalizedName)) {
      return details;
    }

    seen.add(normalizedName);
    details.push(name);
    return details;
  }, []);
};

const normalizeDepartmentPayload = (payload = {}) => {
  const normalizedPayload = {};

  if (Object.prototype.hasOwnProperty.call(payload, "name")) {
    normalizedPayload.name = String(payload.name || "").trim().replace(/\s+/g, " ");
  }

  if (Object.prototype.hasOwnProperty.call(payload, "details")) {
    normalizedPayload.details = normalizeDetails(payload.details);
  }

  return normalizedPayload;
};

// 🔹 ดึงทั้งหมด
exports.getAllDepartments = async (req, res) => {
  try {
    const departments = await Department.find().sort({ name: 1 }).lean();
    res.status(200).json(
      departments.map((department) => ({
        ...department,
        details: department.details || [],
      }))
    );
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 สร้างใหม่
exports.createDepartment = async (req, res) => {
  try {
    const { name, details = [] } = normalizeDepartmentPayload(req.body);
    if (!name) return res.status(400).json({ message: "Name is required" });

    const exists = await Department.findOne({ name });
    if (exists) return res.status(400).json({ message: "Department already exists" });

    const department = new Department({ name, details });
    await department.save();
    res.status(201).json(department);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// 🔹 อัปเดตชื่อ
exports.updateDepartment = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = normalizeDepartmentPayload(req.body);

    if (!Object.keys(updates).length) {
      return res.status(400).json({ message: "Name or details is required" });
    }

    if (Object.prototype.hasOwnProperty.call(updates, "name") && !updates.name) {
      return res.status(400).json({ message: "Name is required" });
    }

    const department = await Department.findById(id);
    if (!department) return res.status(404).json({ message: "Department not found" });

    if (Object.prototype.hasOwnProperty.call(updates, "name")) {
      department.name = updates.name;
    }
    if (Object.prototype.hasOwnProperty.call(updates, "details")) {
      department.details = updates.details;
    }
    await department.save();

    res.status(200).json(department);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
};

// ดึงรายการ Detail ของแผนกสำหรับใช้เป็นตัวเลือกใน Timesheet
exports.getDepartmentDetails = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid department ID" });
    }

    const department = await Department.findById(req.params.id)
      .select("_id name details")
      .lean();

    if (!department) {
      return res.status(404).json({ message: "Department not found" });
    }

    return res.status(200).json({
      departmentId: department._id,
      departmentName: department.name,
      details: department.details || [],
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
};

exports.normalizeDetails = normalizeDetails;
exports.normalizeDepartmentPayload = normalizeDepartmentPayload;
