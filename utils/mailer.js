// utils/mailer.js
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,       // smtp.gmail.com
  port: process.env.SMTP_PORT,       // 587
  secure: false,                     // ต้อง false เวลาใช้ port 587
  auth: {
    user: process.env.SMTP_USER,     // neonworks@neonworks.co.th
    pass: process.env.SMTP_PASS,     // App Password 16 หลัก
  },
  tls: {
    rejectUnauthorized: false,       // ✅ สำคัญมาก! ป้องกัน Gmail TLS ปฏิเสธ connection
  },
});

async function sendMail({ to, subject, html, text }) {
  return transporter.sendMail({
    from: `"NEON FINANCE" <${process.env.SMTP_USER}>`,
    to,
    subject,
    html,
    text,
  });
}

module.exports = { sendMail };
