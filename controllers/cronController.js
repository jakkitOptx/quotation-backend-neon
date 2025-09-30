// controllers/cronController.js
const Quotation = require("../models/Quotation");
const { sendMail } = require("../utils/mailer");

// เลือก URL หน้าเว็บสำหรับแต่ละบริษัท (ปรับได้ผ่าน ENV; มีค่า fallback)
const getFrontendBaseUrl = (qt) => {
  const isOptx =
    typeof qt?.createdByUser === "string" &&
    qt.createdByUser.toLowerCase().includes("@optx");
  const optxUrl = process.env.FRONTEND_URL_OPTX || "https://optxfi.com";
  const neonUrl = process.env.FRONTEND_URL_NEON || "https://neonworksfi.com";
  return isOptx ? optxUrl : neonUrl;
};

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
    const quotations = await Quotation.find({
      approvalStatus: { $in: ["Pending", "Rejected", "Approved"] },
    })
      .populate("clientId", "customerName companyBaseName")
      .populate({
        path: "approvalHierarchy",
        select: "approvalHierarchy",
      })
      .lean();

    // ✅ จัดกลุ่มตาม email ของ "ผู้ที่ถึงคิวอนุมัติ (current pending level)"
    const mapByApprover = new Map();

    for (const qt of quotations) {
      const approvalDoc = Array.isArray(qt.approvalHierarchy)
        ? qt.approvalHierarchy[0]
        : null;
      const steps = approvalDoc?.approvalHierarchy || [];
      if (!steps.length) continue;

      const pendingLevels = steps.filter((s) => s.status === "Pending");
      if (!pendingLevels.length) continue;

      // หา level ต่ำสุดที่ Pending และทุก level ก่อนหน้าต้อง Approved หมด
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

      const currentStep = steps.find(
        (s) => s.level === currentLevel && s.status === "Pending"
      );
      if (!currentStep?.approver) continue;

      const approverEmail = currentStep.approver.trim().toLowerCase();

      // ✅ สร้างข้อมูลเอกสาร + ลิงก์
      const isOptx =
        typeof qt?.createdByUser === "string" &&
        qt.createdByUser.toLowerCase().includes("@optx");
      const companyPrefix = isOptx ? "OPTX" : "NW-QT";
      const year = new Date(qt.documentDate).getFullYear();
      const run = String(qt.runNumber || "").padStart(3, "0");
      const code = `${companyPrefix}(${qt.type})-${year}-${run}`;

      const clientName =
        qt.clientId?.customerName ||
        qt.clientId?.companyBaseName ||
        qt.client ||
        "N/A";

      const baseUrl = getFrontendBaseUrl(qt);
      // 🔗 ลิงก์ไปหน้า detail ของ QT นั้น ๆ (ให้ ProtectedRoute/ Login จัดการ auth)
      // ป้องกัน baseUrl มี / ท้ายสุดซ้ำ
      const base = (baseUrl || "").replace(/\/+$/, "");
      const detailUrl = `${base}/quotation-details/${qt._id}`;

      const item = {
        id: String(qt._id),
        code,
        title: qt.title || "-",
        client: clientName,
        amount: Number(qt.netAmount || qt.total || qt.amount || 0),
        type: qt.type || "-",
        runNumber: qt.runNumber || "-",
        level: currentLevel,
        url: detailUrl,
      };

      if (!mapByApprover.has(approverEmail))
        mapByApprover.set(approverEmail, []);
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

      // HTML rows: ทำ code เป็นลิงก์คลิกได้
      const rows = items
        .map(
          (it) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                <a href="${
                  it.url
                }" target="_blank" style="color:#2563eb;text-decoration:underline;">${
            it.code
          }</a>
              </td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${
                it.title
              }</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${
                it.client
              }</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${it.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </td>
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
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:14px;color:#6b7280;font-size:12px;">
            *อีเมลนี้ถูกส่งอัตโนมัติทุกวันเวลา 11:00 น. คลิกเลขเอกสารเพื่อเปิดรายละเอียด (หากยังไม่ได้ล็อกอิน ระบบจะพาไปหน้า Login และเด้งกลับมาอัตโนมัติ)
          </p>
        </div>
      `;

      // ข้อความล้วน: แทรก URL ต่อท้ายแต่ละบรรทัด
      const text = [
        `มีใบเสนอราคาที่รอคุณอนุมัติจำนวน ${items.length} รายการ`,
        ...items.map(
          (it) =>
            `- ${it.code} | ${it.title} | ${it.client} | ${it.amount.toFixed(
              2
            )} | ${it.url}`
        ),
      ].join("\n");

      tasks.push(
        sendMail({
          to: email,
          // ใช้หัวข้อกลาง จะได้ไม่สับสนกรณีมีทั้ง OPTX/NEON ในฉบับเดียว
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
      console.error("dailyApprovalDigest error:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    return res
      .status(500)
      .json({ message: "Internal error", error: err.message });
  }
};
