const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const permissionServicePath = require.resolve(
  "../services/timesheetPermissionService"
);
const controllerPath = require.resolve("../controllers/timesheetController");
const originalPermissionServiceCache = require.cache[permissionServicePath];
const originalControllerCache = require.cache[controllerPath];

const userId = "aaaaaaaaaaaaaaaaaaaaaaaa";
const otherUserId = "bbbbbbbbbbbbbbbbbbbbbbbb";
const clientId = "cccccccccccccccccccccccc";
const projectId = "dddddddddddddddddddddddd";

let dashboardAccess;

require.cache[permissionServicePath] = {
  id: permissionServicePath,
  filename: permissionServicePath,
  loaded: true,
  exports: {
    canUserApproveTimesheets: async () => false,
    canViewTimesheet: async () => false,
    getViewerDashboardScope: async () => ({
      canViewDashboard: true,
      scope: "all",
      visibleUserIds: [userId],
    }),
    getVisibleDashboardUsers: async () => dashboardAccess,
  },
};
delete require.cache[controllerPath];

const TimesheetEntry = require("../models/TimesheetEntry");
const { getDashboardExportData } = require("../controllers/timesheetController");
const originalAggregate = TimesheetEntry.aggregate;

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

beforeEach(() => {
  dashboardAccess = {
    canViewDashboard: true,
    scope: "all",
    visibleUserIds: [userId],
    data: [
      {
        _id: userId,
        firstName: "Jakkit",
        lastName: "Wangnong",
        username: "Jakkit Wangnong",
        department: "Developer",
        team: "App",
        teamGroup: "Technology",
      },
    ],
  };
});

after(() => {
  TimesheetEntry.aggregate = originalAggregate;

  if (originalPermissionServiceCache) {
    require.cache[permissionServicePath] = originalPermissionServiceCache;
  } else {
    delete require.cache[permissionServicePath];
  }

  if (originalControllerCache) {
    require.cache[controllerPath] = originalControllerCache;
  } else {
    delete require.cache[controllerPath];
  }
});

test("exports flattened daily rows and retains archived projects", async () => {
  TimesheetEntry.aggregate = async (pipeline) => {
    const entryMatch = pipeline[0].$match;
    assert.deepEqual(entryMatch.userId.$in.map(String), [userId]);
    assert.equal(String(entryMatch.clientId), clientId);
    assert.equal(String(entryMatch.projectId), projectId);
    assert.equal(
      pipeline.some((stage) => stage.$match?.["project.isActive"] === true),
      false
    );

    return [
      {
        _id: {
          userId: new mongoose.Types.ObjectId(userId),
          clientId: new mongoose.Types.ObjectId(clientId),
          projectId: new mongoose.Types.ObjectId(projectId),
          workDate: new Date("2025-12-31T17:00:00.000Z"),
        },
        firstName: "Jakkit",
        lastName: "Wangnong",
        username: "jakkit@example.com",
        department: "Developer",
        clientName: "Neon",
        projectName: "Vitamilk",
        projectRemark: "Archived project",
        dayHours: 1.5,
      },
    ];
  };

  const req = {
    user: { _id: otherUserId, role: "admin" },
    query: {
      from: "2026-01-01",
      to: "2026-01-07",
      clientId,
      projectId,
      department: "developer",
      team: "app",
      search: "jakkit",
    },
  };
  const res = createResponse();

  await getDashboardExportData(req, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.data.range, {
    from: "2026-01-01",
    to: "2026-01-07",
  });
  assert.deepEqual(res.data.dates[0], { date: "2026-01-01", day: "Thu" });
  assert.deepEqual(res.data.dates[6], { date: "2026-01-07", day: "Wed" });
  assert.equal(res.data.totalRows, 1);
  assert.equal(res.data.totalHours, 1.5);
  assert.equal(res.data.rows[0].employeeName, "Jakkit Wangnong");
  assert.equal(res.data.rows[0].clientName, "Neon");
  assert.equal(res.data.rows[0].projectName, "Vitamilk");
  assert.equal(res.data.rows[0].dailyHours["2026-01-01"], 1.5);
  assert.equal(res.data.rows[0].dailyHours["2026-01-02"], 0);
});

test("rejects a date range longer than three months", async () => {
  TimesheetEntry.aggregate = async () => {
    throw new Error("aggregate must not run");
  };
  const res = createResponse();

  await getDashboardExportData(
    {
      user: { _id: otherUserId, role: "admin" },
      query: { from: "2026-01-01", to: "2026-04-03" },
    },
    res
  );

  assert.equal(res.statusCode, 400);
  assert.equal(res.data.message, "Date range must not exceed 92 days");
});

test("accepts the longest three-calendar-month range", async () => {
  TimesheetEntry.aggregate = async () => {
    throw new Error("aggregate must not run when no users match the filters");
  };
  const res = createResponse();

  await getDashboardExportData(
    {
      user: { _id: otherUserId, role: "admin" },
      query: {
        from: "2026-07-01",
        to: "2026-09-30",
        department: "No matching department",
      },
    },
    res
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.data.dates.length, 92);
  assert.equal(res.data.totalRows, 0);
});

test("rejects an explicitly requested user outside the dashboard scope", async () => {
  TimesheetEntry.aggregate = async () => {
    throw new Error("aggregate must not run");
  };
  const res = createResponse();

  await getDashboardExportData(
    {
      user: { _id: otherUserId, role: "manager" },
      query: {
        from: "2026-01-01",
        to: "2026-01-07",
        userId: otherUserId,
      },
    },
    res
  );

  assert.equal(res.statusCode, 403);
  assert.equal(
    res.data.message,
    "You do not have permission to view this user's timesheet"
  );
});
