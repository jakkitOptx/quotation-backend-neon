const { test } = require("node:test");
const assert = require("node:assert/strict");
const Client = require("../models/Client");
const {
  getClientProjects,
  normalizeClientPayload,
  normalizeProjects,
} = require("../controllers/clientController");

test("normalizes a client project list", () => {
  assert.deepEqual(
    normalizeProjects([
      " Campaign A ",
      "Campaign   B",
      "campaign a",
      "",
    ]),
    ["Campaign A", "Campaign B"]
  );
});

test("rejects a projects value that is not a list of strings", () => {
  assert.throws(() => normalizeProjects("Campaign A"), /must be an array/);
  assert.throws(() => normalizeProjects(["Campaign A", null]), /must be a string/);
});

test("keeps projects unchanged when an update omits the field", () => {
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      normalizeClientPayload({ email: " A@Example.com " }),
      "projects"
    ),
    false
  );
});

test("client schema defaults projects to an empty list", () => {
  const client = new Client({
    customerName: "Example",
    companyBaseName: "Example Co., Ltd.",
    address: "Bangkok",
    taxIdentificationNumber: "1234567890123",
    contactPhoneNumber: "020000000",
    branchNo: "00000",
  });

  assert.deepEqual(client.projects, []);
});

test("project lookup returns the list belonging to the requested client", async () => {
  const originalFindById = Client.findById;
  const clientId = "aaaaaaaaaaaaaaaaaaaaaaaa";

  Client.findById = (id) => {
    assert.equal(id, clientId);
    return {
      select: () => ({
        lean: async () => ({ _id: clientId, projects: ["Campaign A"] }),
      }),
    };
  };

  const req = { params: { id: clientId } };
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
    await getClientProjects(req, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.data, {
      clientId,
      projects: ["Campaign A"],
    });
  } finally {
    Client.findById = originalFindById;
  }
});
