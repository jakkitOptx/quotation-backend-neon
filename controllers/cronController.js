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
 * GET /api/cron/daily-approval-digest?secret=...
 */
exports.dailyApprovalDigest = async (req, res) => {
  const startedAt = Date.now();

  try {
    // ✅ ตรวจ secret
    const secret = req.query.secret || req.headers["x-cron-secret"];
    if (!secret || secret !== process.env.CRON_SECRET) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // ====== STEP 1: โหลดข้อมูลเฉพาะ Pending + ใส่ลิมิต ======
    const HARD_LIMIT = Number(process.env.CRON_QT_LIMIT || 200);
    console.log("[CRON] fetching quotations (Pending only) ... limit:", HARD_LIMIT);

    const quotations = await Quotation.find({ approvalStatus: "Pending" })
      .limit(HARD_LIMIT)
      .populate("clientId", "customerName companyBaseName")
      .populate({ path: "approvalHierarchy", select: "approvalHierarchy" })
      .lean();

    console.log("[CRON] quotations found:", quotations.length);

    // ====== STEP 2: จัดกลุ่มตาม “ผู้อนุมัติที่ถึงคิว” ======
    const mapByApprover = new Map();

    for (const qt of quotations) {
      const approvalArray = Array.isArray(qt?.approvalHierarchy) ? qt.approvalHierarchy : [];
      const approvalDoc = approvalArray[0] || null;
      const steps = Array.isArray(approvalDoc?.approvalHierarchy)
        ? approvalDoc.approvalHierarchy
        : [];
      if (!steps.length) continue;

      const pendingLevels = steps.filter((s) => s?.status === "Pending");
      if (!pendingLevels.length) continue;

      // หา level ต่ำสุดที่ยัง Pending และก่อนหน้าทั้งหมด Approved
      const candidateLevels = pendingLevels
        .map((s) => Number(s?.level) || 0)
        .sort((a, b) => a - b);

      let currentLevel = null;
      for (const lvl of candidateLevels) {
        const allPrevApproved = steps
          .filter((s) => Number(s?.level) < lvl)
          .every((s) => s?.status === "Approved");
        if (allPrevApproved) {
          currentLevel = lvl;
          break;
        }
      }
      if (currentLevel === null) continue;

      const currentStep = steps.find(
        (s) => Number(s?.level) === currentLevel && s?.status === "Pending"
      );
      const approverEmail = (currentStep?.approver || "").trim().toLowerCase();
      if (!approverEmail) continue;

      // สร้างข้อมูลแสดงผล
      const isOptx =
        typeof qt?.createdByUser === "string" &&
        qt.createdByUser.toLowerCase().includes("@optx");

      const companyPrefix = isOptx ? "OPTX" : "NW-QT";
      const year = new Date(qt?.documentDate || Date.now()).getFullYear();
      const run = String(qt?.runNumber ?? "").padStart(3, "0");
      const code = `${companyPrefix}(${qt?.type || "-"})-${year}-${run}`;

      const clientName =
        qt?.clientId?.customerName ||
        qt?.clientId?.companyBaseName ||
        qt?.client ||
        "N/A";

      const baseUrl = (getFrontendBaseUrl(qt) || "").replace(/\/+$/, "");
      const detailUrl = `${baseUrl}/quotation-details/${qt?._id}`;

      const item = {
        id: String(qt?._id || ""),
        code,
        title: qt?.title || "-",
        client: clientName,
        amount: Number(qt?.netAmount ?? qt?.total ?? qt?.amount ?? 0),
        type: qt?.type || "-",
        runNumber: qt?.runNumber ?? "-",
        level: currentLevel,
        url: detailUrl,
        baseUrl, // สำหรับปุ่ม "ดูเพิ่มเติม"
      };

      if (!mapByApprover.has(approverEmail)) mapByApprover.set(approverEmail, []);
      mapByApprover.get(approverEmail).push(item);
    }

    if (mapByApprover.size === 0) {
      console.log("[CRON] no pending approvers.");
      return res.json({ message: "No pending approvals today. Done." });
    }

    // ====== STEP 3: ส่งเมลแบบ sequential (ทีละคน) + จำกัด 10 รายการล่าสุด ======
    let sent = 0;
    let recipients = 0;

    for (const [email, items] of mapByApprover.entries()) {
      recipients++;

      // เรียง + ตัดเหลือ N ล่าสุด
      items.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.type !== b.type) return ("" + a.type).localeCompare("" + b.type);
        return ("" + a.runNumber).localeCompare("" + b.runNumber);
      });

      const MAX_ITEMS = Number(process.env.CRON_MAX_ITEMS || 10);
      const visibleItems = items.slice(-MAX_ITEMS);
      const hiddenCount = items.length - visibleItems.length;

      const rows = visibleItems
        .map(
          (it) => `
            <tr>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">
                <a href="${it.url}" target="_blank" style="color:#2563eb;text-decoration:underline;">${it.code}</a>
              </td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.title}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;">${it.client}</td>
              <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;">
                ${it.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </td>
            </tr>`
        )
        .join("");

      const listBase = (visibleItems[0]?.baseUrl || items[0]?.baseUrl || "").replace(/\/+$/, "");
      const moreUrl = `${listBase}/approvals`;
      const companyPrefix = listBase.includes("optx") ? "OPTX FINANCE" : "NEON FINANCE";

      const html = `
        <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, 'Helvetica Neue', Arial;">
          <h2 style="margin:0 0 8px;color:#111827;">รายการรออนุมัติของคุณวันนี้</h2>
          <p style="margin:0 0 12px;color:#374151;">มีใบเสนอราคาที่รอคุณอนุมัติทั้งหมด <strong>${items.length}</strong> รายการ</p>
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
          ${
            hiddenCount > 0
              ? `<p style="margin-top:14px;">
                   <a href="${moreUrl}" target="_blank"
                      style="background:#2563eb;color:#fff;padding:8px 12px;border-radius:6px;text-decoration:none;">
                     ดูเพิ่มเติม (${hiddenCount} รายการ)
                   </a>
                 </p>`
              : ""
          }
          <p style="margin-top:14px;color:#6b7280;font-size:12px;">
            *อีเมลนี้ถูกส่งอัตโนมัติทุกวันเวลา 10:00 น. คลิกเลขเอกสารเพื่อเปิดรายละเอียด
          </p>
        </div>
      `;

      const text = [
        `มีใบเสนอราคาที่รอคุณอนุมัติทั้งหมด ${items.length} รายการ`,
        ...visibleItems.map(
          (it) => `- ${it.code} | ${it.title} | ${it.client} | ${it.amount.toFixed(2)} | ${it.url}`
        ),
        hiddenCount > 0 ? `...และมีอีก ${hiddenCount} รายการ ดูเพิ่มเติมที่: ${moreUrl}` : "",
      ].join("\n");

      try {
        console.log(`[CRON] sending to ${email} items=${items.length} (show ${visibleItems.length})`);
        await sendMail({
          to: email,
          subject: `${companyPrefix}: รายการรออนุมัติวันนี้ (${items.length} รายการ)`,
          html,
          text,
        });
        sent++;
      } catch (e) {
        console.error(`[CRON] send fail -> ${email}:`, e?.message || e);
      }
    }

    console.log(`[CRON] done in ${Date.now() - startedAt}ms, recipients=${recipients}, sent=${sent}`);

    return res.json({
      message: "Digest sent.",
      recipients,
      emailsSent: sent,
      tookMs: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("dailyApprovalDigest error:", {
      message: err.message,
      stack: err.stack,
      name: err.name,
    });
    return res.status(500).json({ message: "Internal error", error: err.message });
  }
};
