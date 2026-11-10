const { test } = require("node:test");
const assert = require("node:assert/strict");

let canEditTargetPeriod = true;
const periodAccessPath = require.resolve("../services/timesheetPeriodAccessService");
require.cache[periodAccessPath] = {
  id: periodAccessPath,
  filename: periodAccessPath,
  loaded: true,
  exports: {
    getTimesheetPeriodAccess: async () => ({
      canEdit: canEditTargetPeriod,
      lockReason: canEditTargetPeriod ? null : "deadline",
    }),
  },
};

const TimesheetEntry = require("../models/TimesheetEntry");
const {
  getLatestWeekCloneTemplate,
} = require("../controllers/timesheetController");

const createResponse = () => ({
  statusCode: 200,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(data) {
    this.data = data;
    return this;
  },
});

const createFindQuery = (entries) => ({
  sort() {
    return this;
  },
  populate() {
    return this;
  },
  lean: async () => entries,
});

test("returns unique active Client/Project rows from the latest recorded week", async () => {
  const originalFindOne = TimesheetEntry.findOne;
  const originalFind = TimesheetEntry.find;
  const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const clientId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const projectId = "cccccccccccccccccccccccc";
  let sourceRange;

  TimesheetEntry.findOne = (query) => {
    assert.equal(String(query.userId), userId);
    assert.equal(query.workDate.$lt.toISOString(), "2026-11-08T17:00:00.000Z");
    return {
      sort() {
        return this;
      },
      select() {
        return this;
      },
      lean: async () => ({ workDate: new Date("2026-11-03T17:00:00.000Z") }),
    };
  };
  TimesheetEntry.find = (query) => {
    sourceRange = query.workDate;
    const client = {
      _id: clientId,
      customerName: "Example Client",
    };
    const project = {
      _id: projectId,
      name: "Campaign",
      remark: "Weekly work",
      isActive: true,
    };
    return createFindQuery([
      {
        clientId: client,
        projectId: project,
        workDate: new Date("2026-11-03T17:00:00.000Z"),
        hours: 4,
      },
      {
        clientId: client,
        projectId: project,
        workDate: new Date("2026-11-04T17:00:00.000Z"),
        hours: 5,
      },
      {
        clientId: client,
        projectId: {
          _id: "dddddddddddddddddddddddd",
          name: "Archived",
          isActive: false,
        },
        workDate: new Date("2026-11-05T17:00:00.000Z"),
        hours: 1,
      },
    ]);
  };

  const req = {
    user: { _id: userId },
    query: { periodStart: "2026-11-09" },
  };
  const res = createResponse();

  try {
    canEditTargetPeriod = true;
    await getLatestWeekCloneTemplate(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.data.sourcePeriod, {
      periodStart: "2026-11-02",
      periodEnd: "2026-11-08",
    });
    assert.deepEqual(res.data.targetPeriod, {
      periodStart: "2026-11-09",
      periodEnd: "2026-11-15",
    });
    assert.deepEqual(res.data.data, [
      {
        clientId,
        clientName: "Example Client",
        projectId,
        projectName: "Campaign",
        remark: "Weekly work",
      },
    ]);
    assert.equal(sourceRange.$gte.toISOString(), "2026-11-01T17:00:00.000Z");
    assert.equal(sourceRange.$lt.toISOString(), "2026-11-08T17:00:00.000Z");
  } finally {
    TimesheetEntry.findOne = originalFindOne;
    TimesheetEntry.find = originalFind;
  }
});

test("returns an empty template when the user has no earlier Timesheet week", async () => {
  const originalFindOne = TimesheetEntry.findOne;
  TimesheetEntry.findOne = () => ({
    sort() {
      return this;
    },
    select() {
      return this;
    },
    lean: async () => null,
  });

  const res = createResponse();
  try {
    canEditTargetPeriod = true;
    await getLatestWeekCloneTemplate(
      {
        user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
        query: { periodStart: "2026-11-09" },
      },
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.data.sourcePeriod, null);
    assert.deepEqual(res.data.data, []);
  } finally {
    TimesheetEntry.findOne = originalFindOne;
  }
});

test("rejects cloning into a locked target week", async () => {
  const originalFindOne = TimesheetEntry.findOne;
  let queriedEntries = false;
  TimesheetEntry.findOne = () => {
    queriedEntries = true;
    throw new Error("should not query entries");
  };

  const res = createResponse();
  try {
    canEditTargetPeriod = false;
    await getLatestWeekCloneTemplate(
      {
        user: { _id: "aaaaaaaaaaaaaaaaaaaaaaaa" },
        query: { periodStart: "2026-11-09" },
      },
      res
    );
    assert.equal(res.statusCode, 409);
    assert.equal(queriedEntries, false);
  } finally {
    canEditTargetPeriod = true;
    TimesheetEntry.findOne = originalFindOne;
  }
});
