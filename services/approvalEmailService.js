const { sendMail } = require("../utils/mailer");

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getFrontendBaseUrl = (quotation) => {
  const isOptx = normalizeEmail(quotation?.createdByUser).includes("@optx");

  return (
    (isOptx
      ? process.env.FRONTEND_URL_OPTX || "https://optxfi.com"
      : process.env.FRONTEND_URL_NEON || "https://neonworksfi.com") || ""
  ).replace(/\/+$/, "");
};

const getQuotationCode = (quotation) => {
  const isOptx = normalizeEmail(quotation?.createdByUser).includes("@optx");
  const prefix = isOptx ? "OPTX" : "NW-QT";
  const year = new Date(quotation?.documentDate || Date.now()).getFullYear();
  const runNumber = String(quotation?.runNumber || "").padStart(3, "0");

  return `${prefix}(${quotation?.type || "-"})-${year}-${runNumber}`;
};

const findCurrentApprovalStep = (approval = {}) => {
  const orderedSteps = (approval.approvalHierarchy || [])
    .map((step, index) => ({ step, index }))
    .sort((left, right) => {
      const levelDifference = Number(left.step.level || 0) - Number(right.step.level || 0);
      return levelDifference || left.index - right.index;
    });

  return orderedSteps.find(({ step }, index) => {
    const previousSteps = orderedSteps.slice(0, index).map(({ step: previousStep }) => previousStep);
    return (
      step.status === "Pending" &&
      previousSteps.every((previousStep) => previousStep.status === "Approved")
    );
  })?.step;
};

const buildApprovalEmail = ({ quotation, detailUrl }) => {
  const code = getQuotationCode(quotation);
  const isOptx = normalizeEmail(quotation?.createdByUser).includes("@optx");
  const brandName = isOptx ? "OPTX FINANCE" : "NEON FINANCE";
  const accentColor = isOptx ? "#f59e0b" : "#ec4899";
  const amount = Number(quotation?.netAmount ?? quotation?.total ?? 0);
  const formattedAmount = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const html = `
    <div style="margin:0;padding:32px 16px;background:#f3f4f6;font-family:Arial,sans-serif;color:#1f2937;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 12px 30px rgba(31,41,55,.12);">
        <div style="padding:28px 32px;background:#1f2937;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:1.2px;color:${accentColor};font-weight:700;">${brandName}</div>
          <h1 style="margin:10px 0 0;font-size:24px;line-height:1.3;">Quotation awaiting your approval</h1>
        </div>
        <div style="padding:30px 32px;">
          <p style="margin:0 0 18px;font-size:16px;line-height:1.6;">A quotation is ready for your review and approval.</p>
          <div style="padding:18px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;">
            <div style="font-size:13px;color:#6b7280;margin-bottom:5px;">Quotation No.</div>
            <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:14px;">${escapeHtml(code)}</div>
            <div style="font-size:13px;color:#6b7280;margin-bottom:5px;">Title</div>
            <div style="font-size:15px;color:#111827;margin-bottom:14px;">${escapeHtml(quotation?.title || "-")}</div>
            <div style="font-size:13px;color:#6b7280;margin-bottom:5px;">Client</div>
            <div style="font-size:15px;color:#111827;margin-bottom:14px;">${escapeHtml(quotation?.client || "-")}</div>
            <div style="font-size:13px;color:#6b7280;margin-bottom:5px;">Net amount</div>
            <div style="font-size:15px;font-weight:700;color:#111827;">THB ${formattedAmount}</div>
          </div>
          <div style="margin-top:28px;text-align:center;">
            <a href="${escapeHtml(detailUrl)}" target="_blank" style="display:inline-block;padding:13px 22px;background:${accentColor};color:#ffffff;border-radius:8px;text-decoration:none;font-size:15px;font-weight:700;">Review quotation</a>
          </div>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#6b7280;">This link requires you to sign in with the account assigned to this approval step.</p>
        </div>
      </div>
    </div>`;

  return {
    subject: `${brandName}: Approval required for ${code}`,
    html,
    text: `Quotation awaiting your approval\n${code}\n${quotation?.title || "-"}\nReview: ${detailUrl}`,
  };
};

const notifyCurrentApprover = async ({ approval, quotation }) => {
  const currentStep = findCurrentApprovalStep(approval);

  if (!currentStep) {
    return { sent: false, reason: "No approval step is ready" };
  }

  const recipient = normalizeEmail(currentStep.approver);
  if (!recipient) {
    return { sent: false, reason: "Current approver has no email" };
  }

  if (currentStep.notificationSentAt) {
    return { sent: false, reason: "Current approver was already notified", recipient };
  }

  const detailUrl = `${getFrontendBaseUrl(quotation)}/quotations/${quotation._id}`;
  const message = buildApprovalEmail({ quotation, detailUrl });

  currentStep.notificationAttempts = Number(currentStep.notificationAttempts || 0) + 1;

  try {
    await sendMail({ to: recipient, ...message });
    currentStep.notificationSentAt = new Date();
    currentStep.notificationLastError = "";
    await approval.save();

    return { sent: true, recipient, level: currentStep.level };
  } catch (error) {
    currentStep.notificationLastError = error.message || "Failed to send approval email";
    await approval.save();
    throw error;
  }
};

module.exports = { findCurrentApprovalStep, notifyCurrentApprover };
