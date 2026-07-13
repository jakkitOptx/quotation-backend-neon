// controllers/meetingRoomController.js
const MeetingRoom = require("../models/MeetingRoom");
const MeetingRoomBooking = require("../models/MeetingRoomBooking");
const User = require("../models/User");

const timeToMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

const buildBookingDateFilter = ({ dateKey, startDate, endDate }) => {
  if (dateKey) {
    if (!isDateKey(dateKey)) {
      return { error: "dateKey must be YYYY-MM-DD" };
    }

    return { dateFilter: { dateKey } };
  }

  if (!startDate || !endDate) {
    return { error: "dateKey or startDate and endDate are required" };
  }

  if (!isDateKey(startDate) || !isDateKey(endDate)) {
    return { error: "startDate and endDate must be YYYY-MM-DD" };
  }

  if (startDate > endDate) {
    return { error: "startDate must be less than or equal to endDate" };
  }

  return {
    dateFilter: {
      dateKey: { $gte: startDate, $lte: endDate },
    },
  };
};

const buildFullName = (firstName, lastName) => {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || null;
};

const withBookerProfiles = async (bookings) => {
  const isArray = Array.isArray(bookings);
  const items = isArray ? bookings : [bookings];
  const plainItems = items.filter(Boolean).map((booking) =>
    typeof booking.toObject === "function" ? booking.toObject() : booking
  );

  const userKeys = [
    ...new Set(
      plainItems
        .flatMap((booking) => [booking.createdByUser, booking.createdByEmail])
        .filter(Boolean)
    ),
  ];

  const users = userKeys.length
    ? await User.find({ username: { $in: userKeys } })
        .select("username firstName lastName nickname")
        .lean()
    : [];
  const usersByUsername = new Map(users.map((user) => [user.username, user]));

  const enriched = plainItems.map((booking) => {
    const bookingUser =
      usersByUsername.get(booking.createdByUser) ||
      usersByUsername.get(booking.createdByEmail);

    const createdByFirstName =
      booking.createdByFirstName ?? bookingUser?.firstName ?? null;
    const createdByLastName =
      booking.createdByLastName ?? bookingUser?.lastName ?? null;
    const createdByNickname =
      booking.createdByNickname ?? bookingUser?.nickname ?? null;
    const createdByName =
      booking.createdByName ||
      buildFullName(createdByFirstName, createdByLastName) ||
      booking.createdByUser ||
      booking.createdByEmail ||
      null;

    return {
      ...booking,
      createdByName,
      createdByFirstName,
      createdByLastName,
      createdByNickname,
    };
  });

  return isArray ? enriched : enriched[0];
};

const defaultRooms = [
  {
    code: "R1",
    name: "Meeting Room ตึก Neonworks ชั้น 1",
    floor: 1,
    capacity: 8,
    sortOrder: 1,
    isComingSoon: false,
    comingSoonMessage: "",
  },
  {
    code: "R2",
    name: "Meeting Room ตึก Neonworks ชั้น 2",
    floor: 2,
    capacity: 5,
    sortOrder: 2,
    isComingSoon: false,
    comingSoonMessage: "",
  },
  {
    code: "R3",
    name: "Meeting Room ตึก Neonworks ชั้น 3",
    floor: 3,
    capacity: 12,
    sortOrder: 3,
    isComingSoon: false,
    comingSoonMessage: "",
  },
  {
    code: "R4",
    name: "ตึกฝั่ง TV Thunder ชั้น 1 (ตรงข้ามห้อง HR)",
    floor: 1,
    capacity: 8,
    capacityLabel: "5-8",
    sortOrder: 4,
    isComingSoon: true,
    comingSoonMessage:
      "หากต้องการใช้ห้องประชุมฝั่ง TV Thunder ให้ติดต่อพี่ละอองดาว ผ่าน LINE",
  },
  {
    code: "R5",
    name: "ตึกฝั่ง TV Thunder ชั้น 2",
    floor: 2,
    capacity: 8,
    capacityLabel: "5-8",
    sortOrder: 5,
    isComingSoon: true,
    comingSoonMessage:
      "หากต้องการใช้ห้องประชุมฝั่ง TV Thunder ให้ติดต่อพี่ละอองดาว ผ่าน LINE",
  },
];

const ensureDefaultRooms = async () => {
  await MeetingRoom.bulkWrite(
    defaultRooms.map((room) => ({
      updateOne: {
        filter: { code: room.code },
        update: { $set: room },
        upsert: true,
      },
    }))
  );
};

// ------------------------
// Rooms
// ------------------------
exports.getRooms = async (req, res) => {
  try {
    await ensureDefaultRooms();
    const rooms = await MeetingRoom.find({ isActive: true }).sort({
      sortOrder: 1,
      floor: 1,
      code: 1,
    });
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
    const { roomId, dateKey, startDate, endDate } = req.query;

    if (!roomId) {
      return res.status(400).json({ message: "roomId is required" });
    }

    const { dateFilter, error } = buildBookingDateFilter({
      dateKey,
      startDate,
      endDate,
    });

    if (error) {
      return res.status(400).json({ message: error });
    }

    const bookings = await MeetingRoomBooking.find({ roomId, ...dateFilter })
      .sort({ dateKey: 1, startMin: 1 })
      .lean();

    res.json(await withBookerProfiles(bookings));
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

    const room = await MeetingRoom.findById(roomId).lean();
    if (!room) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (room.isComingSoon) {
      return res.status(403).json({
        message:
          room.comingSoonMessage ||
          "This meeting room is coming soon and cannot be booked yet",
      });
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
    const createdByFirstName = req.user?.firstName || null;
    const createdByLastName = req.user?.lastName || null;
    const createdByNickname = req.user?.nickname || null;

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
      createdByFirstName,
      createdByLastName,
      createdByNickname,
      createdByApp,
      createdByDepartment,
    });

    res.status(201).json(await withBookerProfiles(booking));
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

    const targetRoom = await MeetingRoom.findById(newRoomId).lean();
    if (!targetRoom) {
      return res.status(404).json({ message: "Room not found" });
    }

    if (targetRoom.isComingSoon) {
      return res.status(403).json({
        message:
          targetRoom.comingSoonMessage ||
          "This meeting room is coming soon and cannot be booked yet",
      });
    }

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
    res.json(await withBookerProfiles(booking));
  } catch (err) {
    res.status(500).json({
      message: "Error updating booking",
      error: err.message,
    });
  }
};

exports.getMyBookings = async (req, res) => {
  try {
    const { roomId, dateKey, startDate, endDate } = req.query;

    if (!roomId) {
      return res.status(400).json({ message: "roomId is required" });
    }

    const { dateFilter, error } = buildBookingDateFilter({
      dateKey,
      startDate,
      endDate,
    });

    if (error) {
      return res.status(400).json({ message: error });
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
      ...dateFilter,
      $or: or,
    })
      .sort({ dateKey: 1, startMin: 1 })
      .lean();

    res.json(await withBookerProfiles(bookings));
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
