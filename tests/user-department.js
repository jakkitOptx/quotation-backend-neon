const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  attachDepartmentId,
  buildDepartmentIdMap,
  normalizeDepartmentKey,
} = require("../utils/userDepartment");

test("normalizes department names for profile matching", () => {
  assert.equal(normalizeDepartmentKey(" Client   Service "), "client service");
});

test("adds the matching departmentId to a user profile", () => {
  const departmentId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const departmentIdMap = buildDepartmentIdMap([
    { _id: departmentId, name: "Creative" },
  ]);

  assert.deepEqual(
    attachDepartmentId(
      { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", department: " creative " },
      departmentIdMap
    ),
    {
      _id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      department: " creative ",
      departmentId,
    }
  );
});

test("returns a null departmentId when no master department matches", () => {
  assert.equal(
    attachDepartmentId({ department: "Unknown" }, new Map()).departmentId,
    null
  );
});
