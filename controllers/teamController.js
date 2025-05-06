const Team = require("../models/Team");

// 🔹 ดึงทีมทั้งหมด
exports.getAllTeams = async (req, res) => {
  try {
    const teams = await Team.find().sort({ group: 1, name: 1 });
    res.status(200).json(teams);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 สร้างทีมใหม่
exports.createTeam = async (req, res) => {
  try {
    const { name, group } = req.body;
    if (!name || !group) return res.status(400).json({ message: "Name and group are required" });

    const existing = await Team.findOne({ name });
    if (existing) return res.status(400).json({ message: "Team already exists" });

    const team = new Team({ name, group });
    await team.save();
    res.status(201).json(team);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 🔹 อัปเดตชื่อทีม
exports.updateTeam = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, group } = req.body;

    const team = await Team.findById(id);
    if (!team) return res.status(404).json({ message: "Team not found" });

    if (name) team.name = name;
    if (group) team.group = group;

    await team.save();
    res.status(200).json(team);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
