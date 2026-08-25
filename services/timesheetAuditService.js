const Log = require("../models/Log");

const logTimesheetActivity = async ({
  actor,
  action,
  description,
  entityId,
  metadata = null,
}) => {
  try {
    if (!action || !entityId) {
      return;
    }

    await Log.create({
      timesheetEntityId: entityId,
      resourceType: "timesheet",
      module: "timesheet",
      action,
      performedBy: actor || "unknown",
      description: description || "",
      metadata,
    });
  } catch (error) {
    // Audit persistence must not roll back a completed Timesheet operation.
    console.error("Timesheet audit log error:", error);
  }
};

module.exports = { logTimesheetActivity };
