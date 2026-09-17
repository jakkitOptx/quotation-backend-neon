const { test } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const TimesheetDetail = require("../models/TimesheetDetail");
const { normalizeOptionalRemark } = require("../utils/timesheet");

test("normalizes an optional Timesheet detail remark", () => {
  assert.equal(normalizeOptionalRemark(undefined), "");
  assert.equal(normalizeOptionalRemark(null), "");
  assert.equal(normalizeOptionalRemark("  waiting for artwork  "), "waiting for artwork");
  assert.equal(normalizeOptionalRemark(""), "");
  assert.equal(normalizeOptionalRemark(123), null);
});

test("Timesheet detail remark is optional and defaults to an empty string", () => {
  const detail = new TimesheetDetail({
    userId: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(),
    name: "Artwork",
    normalizedName: "artwork",
  });

  assert.equal(detail.remark, "");
});
