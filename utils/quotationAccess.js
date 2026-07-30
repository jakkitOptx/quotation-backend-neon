const normalizeText = (value = "") => String(value || "").trim().toLowerCase();

const SOSPARKOLS_DEPARTMENTS = ["Sosparkols", "SoSparkKOLs", "SoSparkKols"];
const SOSPARKOLS_DEPARTMENT_KEYS = new Set(
  SOSPARKOLS_DEPARTMENTS.map((department) => normalizeText(department))
);

const isManagementExecutive = (user = {}) =>
  Number(user.level || 0) >= 5 && normalizeText(user.department) === "management";

const isClientServiceAccountPlanner = (value = "") =>
  normalizeText(value) === "client service / account planner";

const isMediaLevel4WithSosparkolsAccess = (user = {}) =>
  Number(user.level || 0) === 4 && normalizeText(user.department) === "media";

const buildQuotationVisibilityQuery = (user = {}) => {
  if (user.role === "admin" || isManagementExecutive(user)) return {};

  const level = Number(user.level || 0);

  if (level === 3 && isClientServiceAccountPlanner(user.department)) {
    return { teamGroup: user.teamGroup || "" };
  }

  if (level >= 3) {
    if (isMediaLevel4WithSosparkolsAccess(user)) {
      return {
        $or: [
          { department: user.department || "" },
          ...SOSPARKOLS_DEPARTMENTS.map((department) => ({
            department: new RegExp(`^${department}$`, "i"),
          })),
        ],
      };
    }

    return { department: user.department || "" };
  }

  if (level === 2) {
    return { teamGroup: user.teamGroup || "" };
  }

  if (level === 1) {
    return user.teamGroup
      ? { teamGroup: user.teamGroup || "" }
      : { createdByUser: user.username || "" };
  }

  return { createdByUser: user.username || "" };
};

const canAccessSosparkolsQuotation = (user, quotation) =>
  isMediaLevel4WithSosparkolsAccess(user) &&
  SOSPARKOLS_DEPARTMENT_KEYS.has(normalizeText(quotation?.department));

const canViewQuotation = (user, quotation) => {
  if (!user || !quotation) return false;
  if (user.role === "admin" || isManagementExecutive(user)) return true;

  const level = Number(user.level || 0);

  if (level === 3 && isClientServiceAccountPlanner(user.department)) {
    return String(quotation.teamGroup || "") === String(user.teamGroup || "");
  }

  if (level >= 3) {
    return (
      String(quotation.department || "") === String(user.department || "") ||
      canAccessSosparkolsQuotation(user, quotation)
    );
  }

  if (level === 2) {
    return String(quotation.teamGroup || "") === String(user.teamGroup || "");
  }

  if (level === 1) {
    return user.teamGroup
      ? String(quotation.teamGroup || "") === String(user.teamGroup || "")
      : String(quotation.createdByUser || "") === String(user.username || "");
  }

  return String(quotation.createdByUser || "") === String(user.username || "");
};

const canEditQuotation = (user, quotation) => {
  if (!user || !quotation) return false;
  if (user.role === "admin" || isManagementExecutive(user)) return true;

  const level = Number(user.level || 0);
  if (level === 1) {
    return String(quotation.createdByUser || "") === String(user.username || "");
  }

  return true;
};

const canApproveAcrossDepartments = (user, quotation) =>
  user?.role === "admin" ||
  isManagementExecutive(user) ||
  canAccessSosparkolsQuotation(user, quotation);

module.exports = {
  buildQuotationVisibilityQuery,
  canEditQuotation,
  canApproveAcrossDepartments,
  canViewQuotation,
  isManagementExecutive,
  isMediaLevel4WithSosparkolsAccess,
};
