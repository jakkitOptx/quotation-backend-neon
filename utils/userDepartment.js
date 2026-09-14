const Department = require("../models/Department");

const normalizeDepartmentKey = (value) =>
  String(value || "").trim().replace(/\s+/g, " ").toLowerCase();

const buildDepartmentIdMap = (departments = []) =>
  new Map(
    departments
      .map((department) => [
        normalizeDepartmentKey(department?.name),
        department?._id || null,
      ])
      .filter(([name, id]) => name && id)
  );

const attachDepartmentId = (user, departmentIdMap) => {
  const profile = user?.toObject ? user.toObject() : { ...user };

  return {
    ...profile,
    departmentId:
      departmentIdMap.get(normalizeDepartmentKey(profile.department)) || null,
  };
};

const enrichUsersWithDepartmentId = async (users = []) => {
  if (!users.length) return [];

  const departments = await Department.find({}, "_id name").lean();
  const departmentIdMap = buildDepartmentIdMap(departments);

  return users.map((user) => attachDepartmentId(user, departmentIdMap));
};

module.exports = {
  attachDepartmentId,
  buildDepartmentIdMap,
  enrichUsersWithDepartmentId,
  normalizeDepartmentKey,
};
