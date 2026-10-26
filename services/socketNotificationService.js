const SOCKET_EMIT_URL = "https://socket-server-h4f6.onrender.com/emit";
const SOCKET_EMIT_TIMEOUT_MS = 3000;

// Same room key format as the quotation approval notifications.
const getRoomKey = (recipient) => {
  const email = String(recipient || "").toLowerCase().trim();
  const domain = email.includes("@optx")
    ? "optx"
    : email.includes("@neonworks")
    ? "neonworks"
    : "general";
  return `${domain}:${email}`;
};

const sendSocketNotification = async (to, title, message) => {
  try {
    await fetch(SOCKET_EMIT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: getRoomKey(to), title, message }),
      // A cold socket server must not hold the API response open.
      signal: AbortSignal.timeout(SOCKET_EMIT_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("⚠️ Failed to send socket notification:", error.message);
  }
};

module.exports = { getRoomKey, sendSocketNotification };
