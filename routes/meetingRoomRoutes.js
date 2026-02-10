// routes/meetingRoomRoutes.js
const express = require("express");
const router = express.Router();

const authMiddleware = require("../middlewares/authMiddleware");

// ✅ เปลี่ยน require ให้ตรงชื่อที่คุณใช้
const {
  getRooms,
  getBookings,
  createBooking,
  updateBooking,
  deleteBooking,
  getMyBookings
} = require("../controllers/meetingRoomController");

router.use(authMiddleware);

router.get("/rooms", getRooms);
router.get("/bookings", getBookings);
router.post("/bookings", createBooking);
router.patch("/bookings/:id", updateBooking);
router.get("/bookings/mine", getMyBookings);
router.delete("/bookings/:id", deleteBooking);

module.exports = router;
