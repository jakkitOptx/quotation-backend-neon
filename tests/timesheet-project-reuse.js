const { test } = require("node:test");
const assert = require("node:assert/strict");
const Client = require("../models/Client");
const Log = require("../models/Log");
const TimesheetProject = require("../models/TimesheetProject");
const { createProject } = require("../controllers/timesheetController");

test("returns an existing active project instead of a duplicate conflict", async () => {
  const originalClientFindById = Client.findById;
  const originalProjectFindOne = TimesheetProject.findOne;
  const clientId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const userId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";

  Client.findById = () => ({
    select: () => ({ lean: async () => ({ _id: clientId }) }),
  });
  TimesheetProject.findOne = (query) => ({
    lean: async () => {
      assert.equal(String(query.userId), userId);
      assert.equal(String(query.clientId), clientId);
      assert.equal(query.normalizedName, "campaign 2");
      assert.equal(query.isActive, true);
      return {
        _id: projectId,
        userId,
        clientId,
        name: "Campaign 2",
        normalizedName: "campaign 2",
        remark: "",
        isActive: true,
      };
    },
  });

  const req = {
    body: { clientId, name: "Campaign 2" },
    user: { _id: userId, username: "user@example.com" },
  };
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
    await createProject(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.reused, true);
    assert.equal(String(res.data.data._id), projectId);
    assert.equal(String(res.data.data.clientId), clientId);
  } finally {
    Client.findById = originalClientFindById;
    TimesheetProject.findOne = originalProjectFindOne;
  }
});

test("reactivates an archived project when the same project is added again", async () => {
  const originalClientFindById = Client.findById;
  const originalProjectFindOne = TimesheetProject.findOne;
  const originalProjectFindOneAndUpdate = TimesheetProject.findOneAndUpdate;
  const originalLogCreate = Log.create;
  const clientId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const userId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "dddddddddddddddddddddddd";

  Client.findById = () => ({
    select: () => ({ lean: async () => ({ _id: clientId }) }),
  });
  TimesheetProject.findOne = () => ({ lean: async () => null });
  TimesheetProject.findOneAndUpdate = (query, update, options) => ({
    lean: async () => {
      assert.equal(String(query.userId), userId);
      assert.equal(String(query.clientId), clientId);
      assert.equal(query.normalizedName, "campaign 2");
      assert.equal(query.isActive, false);
      assert.equal(update.$set.name, "Campaign 2");
      assert.equal(update.$set.remark, "Backlog");
      assert.equal(update.$set.isActive, true);
      assert.equal(options.new, true);
      return {
        _id: projectId,
        userId,
        clientId,
        name: "Campaign 2",
        normalizedName: "campaign 2",
        remark: "Backlog",
        isActive: true,
      };
    },
  });
  Log.create = async () => ({});

  const req = {
    body: { clientId, name: "Campaign 2", remark: "Backlog" },
    user: { _id: userId, username: "user@example.com" },
  };
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
    await createProject(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.reused, true);
    assert.equal(res.data.reactivated, true);
    assert.equal(String(res.data.data._id), projectId);
    assert.equal(res.data.data.isActive, true);
  } finally {
    Client.findById = originalClientFindById;
    TimesheetProject.findOne = originalProjectFindOne;
    TimesheetProject.findOneAndUpdate = originalProjectFindOneAndUpdate;
    Log.create = originalLogCreate;
  }
});
