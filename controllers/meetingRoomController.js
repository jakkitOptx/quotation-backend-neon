// controllers/meetingRoomController.js
const MeetingRoom = require("../models/MeetingRoom");
const MeetingRoomBooking = require("../models/MeetingRoomBooking");

const timeToMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// ✅ สร้างห้อง default 3 ห้อง (ถ้าใน DB ยังไม่มี)
const ensureDefaultRooms = async () => {
  const count = await MeetingRoom.countDocuments();
  if (count > 0) return;

  await MeetingRoom.insertMany([
    { code: "R1", name: "Meeting Room ชั้น 1", floor: 1, capacity: 8 },
    { code: "R2", name: "Meeting Room ชั้น 2", floor: 2, capacity: 5 },
    { code: "R3", name: "Meeting Room ชั้น 3", floor: 3, capacity: 12 },
  ]);
};

// ------------------------
// Rooms
// ------------------------
exports.getRooms = async (req, res) => {
  try {
    await ensureDefaultRooms();
    const rooms = await MeetingRoom.find({ isActive: true }).sort({ floor: 1 });
    res.json(rooms);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching rooms", error: err.message });
  }
};

// ------------------------
// Bookings
// ------------------------
exports.getBookings = async (req, res) => {
  try {
    const { roomId, dateKey } = req.query;

    if (!roomId || !dateKey) {
      return res
        .status(400)
        .json({ message: "roomId and dateKey are required" });
    }

    const bookings = await MeetingRoomBooking.find({ roomId, dateKey })
      .sort({ startMin: 1 })
      .lean();

    res.json(bookings);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching bookings", error: err.message });
  }
};

exports.createBooking = async (req, res) => {
  try {
    const { roomId, dateKey, startTime, endTime, purpose } = req.body;

    if (!roomId || !dateKey || !startTime || !endTime) {
      return res.status(400).json({
        message: "roomId, dateKey, startTime, endTime are required",
      });
    }

    const startMin = timeToMin(startTime);
    const endMin = timeToMin(endTime);

    if (endMin <= startMin) {
      return res
        .status(400)
        .json({ message: "endTime must be greater than startTime" });
    }

    // ✅ เช็คชน
    const conflict = await MeetingRoomBooking.findOne({
      roomId,
      dateKey,
      startMin: { $lt: endMin },
      endMin: { $gt: startMin },
    }).lean();

    if (conflict) {
      return res.status(409).json({
        message: "Time conflict: this room is already booked in that period",
        conflict,
      });
    }

    // =========================
    // ✅ ส่วนที่เพิ่มเข้ามา
    // =========================
    const createdByUser = req.user?.username || null;
    const createdByEmail = req.user?.email || null;

    const createdByName =
      req.user?.firstName && req.user?.lastName
        ? `${req.user.firstName} ${req.user.lastName}`
        : req.user?.username || req.user?.email || null;

    const createdByApp =
      (req.user?.company || "").toUpperCase() === "OPTX" ? "OPTX" : "NEON";

    const createdByDepartment = req.user?.department || null;

    const booking = await MeetingRoomBooking.create({
      roomId,
      dateKey,
      startMin,
      endMin,
      startTime,
      endTime,
      purpose: purpose?.trim() || "-",

      // ของเดิม
      createdByUser,
      createdByEmail,

      // ✅ ของใหม่
      createdByName,
      createdByApp,
      createdByDepartment,
    });

    res.status(201).json(booking);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error creating booking", error: err.message });
  }
};

exports.updateBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { roomId, dateKey, startTime, endTime, purpose } = req.body;

    const booking = await MeetingRoomBooking.findById(id);
    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    // =========================
    // ✅ เช็คสิทธิ์ (แก้ตรงนี้)
    // =========================
    const sameUsername =
      req.user?.username && booking.createdByUser === req.user.username;

    const sameEmail =
      req.user?.email && booking.createdByEmail === req.user.email;

    const sameNameAndApp =
      booking.createdByName &&
      req.user &&
      booking.createdByName ===
        (req.user.firstName && req.user.lastName
          ? `${req.user.firstName} ${req.user.lastName}`
          : req.user.username || req.user.email) &&
      booking.createdByApp ===
        ((req.user.company || "").toUpperCase() === "OPTX" ? "OPTX" : "NEON");

    const isOwner = sameUsername || sameEmail || sameNameAndApp;

    const isAdmin = req.user?.role === "admin" || req.user?.level === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Forbidden: not allowed" });
    }

    // =========================
    // ✅ Logic เดิม (ไม่ต้องแตะ)
    // =========================
    const newRoomId = roomId || booking.roomId.toString();
    const newDateKey = dateKey || booking.dateKey;
    const newStartTime = startTime || booking.startTime;
    const newEndTime = endTime || booking.endTime;

    const newStartMin = timeToMin(newStartTime);
    const newEndMin = timeToMin(newEndTime);

    if (newEndMin <= newStartMin) {
      return res
        .status(400)
        .json({ message: "endTime must be greater than startTime" });
    }

    // เช็คชน (ยกเว้นตัวเอง)
    const conflict = await MeetingRoomBooking.findOne({
      _id: { $ne: id },
      roomId: newRoomId,
      dateKey: newDateKey,
      startMin: { $lt: newEndMin },
      endMin: { $gt: newStartMin },
    }).lean();

    if (conflict) {
      return res.status(409).json({
        message: "Time conflict: this room is already booked in that period",
        conflict,
      });
    }

    // =========================
    // ✅ อัปเดตข้อมูล (ห้ามแตะ createdBy*)
    // =========================
    booking.roomId = newRoomId;
    booking.dateKey = newDateKey;
    booking.startTime = newStartTime;
    booking.endTime = newEndTime;
    booking.startMin = newStartMin;
    booking.endMin = newEndMin;
    booking.purpose = purpose?.trim() ?? booking.purpose;

    await booking.save();
    res.json(booking);
  } catch (err) {
    res.status(500).json({
      message: "Error updating booking",
      error: err.message,
    });
  }
};

exports.getMyBookings = async (req, res) => {
  try {
    const { roomId, dateKey } = req.query;

    if (!roomId || !dateKey) {
      return res
        .status(400)
        .json({ message: "roomId and dateKey are required" });
    }

    // ✅ filter เฉพาะของตัวเอง (ใช้ username/email ที่เชื่อถือได้ที่สุด)
    const or = [];
    if (req.user?.username) or.push({ createdByUser: req.user.username });
    if (req.user?.email) or.push({ createdByEmail: req.user.email });

    if (or.length === 0) {
      return res.status(401).json({ message: "User identity missing" });
    }

    const bookings = await MeetingRoomBooking.find({
      roomId,
      dateKey,
      $or: or,
    })
      .sort({ startMin: 1 })
      .lean();

    res.json(bookings);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error fetching my bookings", error: err.message });
  }
};


exports.deleteBooking = async (req, res) => {
  try {
    const { id } = req.params;

    const booking = await MeetingRoomBooking.findById(id);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const sameUsername =
      req.user?.username && booking.createdByUser === req.user.username;

    const sameEmail =
      req.user?.email && booking.createdByEmail === req.user.email;

    const sameNameAndApp =
      booking.createdByName &&
      req.user &&
      booking.createdByName ===
        (req.user.firstName && req.user.lastName
          ? `${req.user.firstName} ${req.user.lastName}`
          : req.user.username || req.user.email) &&
      booking.createdByApp ===
        ((req.user.company || "").toUpperCase() === "OPTX" ? "OPTX" : "NEON");

    const isOwner = sameUsername || sameEmail || sameNameAndApp;

    const isAdmin = req.user?.role === "admin" || req.user?.level === "admin";

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "Forbidden: not allowed" });
    }

    await MeetingRoomBooking.deleteOne({ _id: id });
    res.json({ message: "Booking deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error deleting booking", error: err.message });
  }
};
