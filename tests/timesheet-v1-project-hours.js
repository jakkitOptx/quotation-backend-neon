const assert = require("assert");
const TimesheetEntry = require("../models/TimesheetEntry");
const TimesheetProject = require("../models/TimesheetProject");
const { normalizeOptionalRemark } = require("../utils/timesheet");

assert.strictEqual(TimesheetEntry.schema.path("detailId"), undefined);
assert.ok(TimesheetEntry.schema.path("projectId")?.isRequired);

const uniqueProjectDateIndex = TimesheetEntry.schema.indexes().find(
  ([keys, options]) =>
    keys.userId === 1 &&
    keys.projectId === 1 &&
    keys.workDate === 1 &&
    options.unique === true
);
assert.ok(uniqueProjectDateIndex, "Project/date unique index is required");

assert.strictEqual(TimesheetProject.schema.path("remark").defaultValue, "");
assert.strictEqual(normalizeOptionalRemark(undefined), "");
assert.strictEqual(normalizeOptionalRemark(null), "");
assert.strictEqual(normalizeOptionalRemark("  optional note  "), "optional note");
assert.strictEqual(normalizeOptionalRemark(123), null);

console.log("Timesheet v1 project-hours checks passed");
