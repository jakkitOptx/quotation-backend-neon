const { test } = require("node:test");
const assert = require("node:assert/strict");
const Department = require("../models/Department");
const {
  getDepartmentDetails,
  normalizeDepartmentPayload,
  normalizeDetails,
} = require("../controllers/departmentController");

test("normalizes a department detail list", () => {
  assert.deepEqual(
    normalizeDetails([" Artwork ", "Media   Plan", "artwork", ""]),
    ["Artwork", "Media Plan"]
  );
});

test("rejects a details value that is not a list of strings", () => {
  assert.throws(() => normalizeDetails("Artwork"), /must be an array/);
  assert.throws(() => normalizeDetails(["Artwork", null]), /must be a string/);
});

test("allows a partial update containing only details", () => {
  assert.deepEqual(normalizeDepartmentPayload({ details: ["Artwork"] }), {
    details: ["Artwork"],
  });
});

test("department schema defaults details to an empty list", () => {
  const department = new Department({ name: "Creative" });
  assert.deepEqual(department.details, []);
});

test("detail lookup returns the list belonging to the requested department", async () => {
  const originalFindById = Department.findById;
  const departmentId = "aaaaaaaaaaaaaaaaaaaaaaaa";

  Department.findById = (id) => {
    assert.equal(id, departmentId);
    return {
      select: () => ({
        lean: async () => ({
          _id: departmentId,
          name: "Creative",
          details: ["Artwork"],
        }),
      }),
    };
  };

  const req = { params: { id: departmentId } };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.data = data;
      return this;
    },
  };

  try {
    await getDepartmentDetails(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.data, {
      departmentId,
      departmentName: "Creative",
      details: ["Artwork"],
    });
  } finally {
    Department.findById = originalFindById;
  }
});
