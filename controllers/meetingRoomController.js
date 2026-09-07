// controllers/meetingRoomController.js
const MeetingRoom = require("../models/MeetingRoom");
const MeetingRoomBooking = require("../models/MeetingRoomBooking");
const User = require("../models/User");

const timeToMin = (t) => {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

const pad2 = (n) => String(n).padStart(2, "0");
const minToTime = (mins) =>
  `${pad2(Math.floor(mins / 60))}:${pad2(mins % 60)}`;

const isDateKey = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

const MEETING_ROOM_TIME_ZONE = "Asia/Bangkok";
const WORK_PERIODS = [
  { order: 1, key: "morning", label: "09:00 - 12:00", startMin: 9 * 60, endMin: 12 * 60 },
  { order: 2, key: "afternoon", label: "13:00 - 18:00", startMin: 13 * 60, endMin: 18 * 60 },
];
const LUNCH_BREAK = {
  key: "lunch",
  label: "12:00 - 13:00",
  startTime: "12:00",
  endTime: "13:00",
  startMin: 12 * 60,
  endMin: 13 * 60,
};
const DAY_SORT_CONFIG = {
  1: { dayName: "Monday", dayNameTh: "จันทร์", workMode: "office", dayOrder: 1 },
  2: { dayName: "Tuesday", dayNameTh: "อังคาร", workMode: "office", dayOrder: 2 },
  4: { dayName: "Thursday", dayNameTh: "พฤหัส", workMode: "office", dayOrder: 3 },
  3: { dayName: "Wednesday", dayNameTh: "พุธ", workMode: "work_from_home", dayOrder: 4 },
  5: { dayName: "Friday", dayNameTh: "ศุกร์", workMode: "work_from_home", dayOrder: 5 },
  6: { dayName: "Saturday", dayNameTh: "เสาร์", workMode: "weekend", dayOrder: 6 },
  0: { dayName: "Sunday", dayNameTh: "อาทิตย์", workMode: "weekend", dayOrder: 7 },
};

const getTodayDateKey = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MEETING_ROOM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  return `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
};

const getCurrentTimeInfo = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: MEETING_ROOM_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  const getPart = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(getPart("hour"));
  const minute = Number(getPart("minute"));

  return {
    currentTime: `${pad2(hour)}:${pad2(minute)}`,
    currentMin: hour * 60 + minute,
    currentSlotStartMin: Math.floor((hour * 60 + minute) / 30) * 30,
  };
};

const getDayInfo = (dateKey) => {
  const [year, month, dayOfMonth] = dateKey.split("-").map(Number);
  const day = new Date(Date.UTC(year, month - 1, dayOfMonth)).getUTCDay();
  return DAY_SORT_CONFIG[day];
};

const buildFreeSlots = (bookings, currentTimeInfo) => {
  return WORK_PERIODS.flatMap((period) => {
    const overlappingBookings = bookings
      .filter(
        (booking) =>
          Number(booking.startMin) < period.endMin &&
          Number(booking.endMin) > period.startMin
      )
      .map((booking) => ({
        startMin: Math.max(Number(booking.startMin), period.startMin),
        endMin: Math.min(Number(booking.endMin), period.endMin),
      }))
      .sort((a, b) => a.startMin - b.startMin);

    const mergedBookings = overlappingBookings.reduce((merged, booking) => {
      const previous = merged[merged.length - 1];
      if (!previous || booking.startMin > previous.endMin) {
        merged.push({ ...booking });
        return merged;
      }

      previous.endMin = Math.max(previous.endMin, booking.endMin);
      return merged;
    }, []);

    const freeSlots = [];
    let cursor = period.startMin;

    mergedBookings.forEach((booking) => {
      if (cursor < booking.startMin) {
        freeSlots.push({ startMin: cursor, endMin: booking.startMin });
      }
      cursor = Math.max(cursor, booking.endMin);
    });

    if (cursor < period.endMin) {
      freeSlots.push({ startMin: cursor, endMin: period.endMin });
    }

    return freeSlots
      .filter((slot) => slot.endMin > currentTimeInfo.currentMin)
      .map((slot) => ({
        ...slot,
        startMin:
          slot.startMin < currentTimeInfo.currentMin
            ? Math.max(slot.startMin, currentTimeInfo.currentSlotStartMin)
            : slot.startMin,
      }))
      .filter((slot) => slot.startMin < slot.endMin)
      .map((slot, index) => ({
        periodOrder: period.order,
        period: period.key,
        periodLabel: period.label,
        slotOrder: index + 1,
        startTime: minToTime(slot.startMin),
        endTime: minToTime(slot.endMin),
        startMin: slot.startMin,
        endMin: slot.endMin,
        label: `${minToTime(slot.startMin)} - ${minToTime(slot.endMin)}`,
        isCurrentSlot:
          slot.startMin <= currentTimeInfo.currentMin &&
          currentTimeInfo.currentMin < slot.endMin,
      }));
  });
};

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

exports.getTodayAvailability = async (req, res) => {
  try {
    await ensureDefaultRooms();

    const dateKey = getTodayDateKey();
    const dayInfo = getDayInfo(dateKey);
    const currentTimeInfo = getCurrentTimeInfo();

    if (dayInfo.workMode === "weekend") {
      return res.json({
        dateKey,
        timezone: MEETING_ROOM_TIME_ZONE,
        ...currentTimeInfo,
        ...dayInfo,
        isWorkingDay: false,
        workPeriods: [],
        lunchBreak: LUNCH_BREAK,
        totalAvailableRooms: 0,
        availableRooms: [],
      });
    }

    const rooms = await MeetingRoom.find({
      isActive: true,
      isComingSoon: { $ne: true },
    })
      .sort({ sortOrder: 1, floor: 1, code: 1 })
      .lean();

    const bookings = await MeetingRoomBooking.find({
      dateKey,
      roomId: { $in: rooms.map((room) => room._id) },
    })
      .sort({ roomId: 1, startMin: 1 })
      .lean();

    const bookingsByRoomId = bookings.reduce((map, booking) => {
      const roomId = String(booking.roomId);
      if (!map.has(roomId)) map.set(roomId, []);
      map.get(roomId).push(booking);
      return map;
    }, new Map());

    const availableRooms = rooms
      .map((room) => {
        const roomBookings = bookingsByRoomId.get(String(room._id)) || [];
        const availableSlots = buildFreeSlots(roomBookings, currentTimeInfo);

        return {
          room,
          roomId: room._id,
          roomCode: room.code,
          roomName: room.name,
          floor: room.floor,
          capacity: room.capacity,
          capacityLabel: room.capacityLabel,
          availableSlots,
        };
      })
      .filter((item) => item.availableSlots.length > 0)
      .map((item, index) => ({
        order: index + 1,
        ...item,
      }));

    res.json({
      dateKey,
      timezone: MEETING_ROOM_TIME_ZONE,
      ...currentTimeInfo,
      ...dayInfo,
      isWorkingDay: true,
      workPeriods: WORK_PERIODS.map((period) => ({
        order: period.order,
        key: period.key,
        label: period.label,
        startTime: minToTime(period.startMin),
        endTime: minToTime(period.endMin),
        startMin: period.startMin,
        endMin: period.endMin,
      })),
      lunchBreak: LUNCH_BREAK,
      sortPolicy: {
        dayOrder: ["Monday", "Tuesday", "Thursday", "Wednesday", "Friday"],
        officeDaysFirst: true,
        wfhDaysLast: true,
        roomOrder: "sortOrder, floor, code",
      },
      totalAvailableRooms: availableRooms.length,
      availableRooms,
    });
  } catch (err) {
    res.status(500).json({
      message: "Error fetching today's meeting room availability",
      error: err.message,
    });
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
