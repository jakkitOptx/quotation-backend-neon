// controllers/cronController.js
const Quotation = require("../models/Quotation");
const { sendMail } = require("../utils/mailer");

/**
 * ส่งเมลสรุปใบเสนอราคาที่ "ถึงคิว" ของผู้อนุมัติแต่ละคน (เฉพาะ level ปัจจุบัน)
 * เรียกด้วย GET /api/cron/daily-approval-digest?secret=...
 */
exports.dailyApprovalDigest = async (req, res) => {
  try {
    // ✅ ป้องกันด้วย secret
    const secret = req.query.secret || req.headers["x-cron-secret"];
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // ✅ ดึง QT ที่ยังไม่ Draft และไม่ถูก Canceled
    //    (ให้ครอบคลุมทั้ง Pending/Rejected ที่ยังค้างในขั้นต่อไป)
    const quotations = await Quotation.find({
      approvalStatus: { $in: ["Pending", "Rejected", "Approved"] }, // อนุโลมไว้ แต่จะคัดกรองด้วย flow อีกที
    })
      .populate(
        "clientId",
        "customerName companyBaseName" // ← มีสองฟิลด์นี้ใน Client
      )
      .populate({
        path: "approvalHierarchy",
        select: "approvalHierarchy", // ← ดึง steps มาจริง
      })
      .lean();

    // ✅ จัดกลุ่มตาม email ของ "ผู้ที่ถึงคิวอนุมัติ (current pending level)"
    const mapByApprover = new Map();

    for (const qt of quotations) {
      // หา steps จากเอกสาร Approval (ตัวแรก)
      const approvalDoc = Array.isArray(qt.approvalHierarchy)
        ? qt.approvalHierarchy[0]
        : null;

      const steps = approvalDoc?.approvalHierarchy || [];

      if (!steps.length) continue;

      // หา level ที่ยัง Pending ทั้งหมด
      const pendingLevels = steps.filter((s) => s.status === "Pending");
      if (!pendingLevels.length) continue;

      // หา "current level" = level ต่ำสุดที่ Pending และทุก level ก่อนหน้าต้อง Approved หมด
      const candidateLevels = pendingLevels
        .map((s) => s.level)
        .sort((a, b) => a - b);
      let currentLevel = null;
      for (const lvl of candidateLevels) {
        const allPrevApproved = steps
          .filter((s) => s.level < lvl)
          .every((s) => s.status === "Approved");
        if (allPrevApproved) {
          currentLevel = lvl;
          break;
        }
      }
      if (currentLevel === null) continue;

      // ดึง step เฉพาะ current level
      const currentStep = steps.find(
        (s) => s.level === currentLevel && s.status === "Pending"
      );
      if (!currentStep?.approver) continue;

      const approverEmail = currentStep.approver.trim().toLowerCase();

      // ✅ ชื่อเอกสาร และรหัสเอกสารตาม format ระบบ
      const companyPrefix = qt.createdByUser?.includes("@optx")
        ? "OPTX"
        : "NW-QT";
      const year = new Date(qt.documentDate).getFullYear();
      const run = String(qt.runNumber || "").padStart(3, "0");
      const code = `${companyPrefix}(${qt.type})-${year}-${run}`;

      const clientName =
        qt.clientId?.customerName ||
        qt.clientId?.companyBaseName ||
        qt.client ||
        "N/A";

      const item = {
        id: String(qt._id),
        code,
        title: qt.title || "-",
        client: clientName,
        amount: Number(qt.netAmount || qt.total || qt.amount || 0),
        type: qt.type || "-",
        runNumber: qt.runNumber || "-",
        level: currentLevel,
      };

      if (!mapByApprover.has(approverEmail)) mapByApprover.set(approverEmail, []);
      mapByApprover.get(approverEmail).push(item);
    }

    if (mapByApprover.size === 0) {
      return res.json({ message: "No pending approvals today. Done." });
    }

    // ✅ ส่งเมลรายคน
    let sent = 0;
    const tasks = [];

    for (const [email, items] of mapByApprover.entries()) {
      items.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.type !== b.type) return ("" + a.type).localeCompare("" + b.type);
        return ("" + a.runNumber).localeCompare("" + b.runNumber);
      });

      const rows = items
        .map(
          (it) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.code}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.title}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.client}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${it.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center;">L${it.level}</td>
            </tr>`
        )
        .join("");

      const html = `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial;">
          <h2 style="margin:0 0 8px;color:#111827;">รายการรออนุมัติของคุณวันนี้</h2>
          <p style="margin:0 0 12px;color:#374151;">มีใบเสนอราคาที่รอคุณอนุมัติจำนวน <strong>${items.length}</strong> รายการ</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px;">
            <thead>
              <tr style="background:#f9fafb;">
                <th style="text-align:left;padding:8px;">Quotation No.</th>
                <th style="text-align:left;padding:8px;">Title</th>
                <th style="text-align:left;padding:8px;">Client</th>
                <th style="text-align:right;padding:8px;">Amount</th>
                <th style="text-align:center;padding:8px;">Level</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:14px;color:#6b7280;font-size:12px;">
            *อีเมลนี้ถูกส่งอัตโนมัติทุกวันเวลา 11:00 น.
          </p>
        </div>
      `;

      const text = [
        `มีใบเสนอราคาที่รอคุณอนุมัติจำนวน ${items.length} รายการ`,
        ...items.map(
          (it) =>
            `- ${it.code} | ${it.title} | ${it.client} | ${it.amount.toFixed(2)} | L${it.level}`
        ),
      ].join("\n");

      tasks.push(
        sendMail({
          to: email,
          subject: `NEON FINANCE: รายการรออนุมัติวันนี้ (${items.length} รายการ)`,
          html,
          text,
        }).then(() => sent++)
      );
    }

    await Promise.allSettled(tasks);

    return res.json({
      message: "Digest sent.",
      recipients: mapByApprover.size,
      emailsSent: sent,
    });
  } catch (err) {
    console.error("dailyApprovalDigest error:", err);
    return res.status(500).json({ message: "Internal error", error: err.message });
  }
};
