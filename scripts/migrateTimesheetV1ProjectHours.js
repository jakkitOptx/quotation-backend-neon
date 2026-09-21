const dotenv = require("dotenv");
const mongoose = require("mongoose");

dotenv.config();

const sameKeys = (actual = {}, expected = {}) => {
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(expected);
  return (
    actualEntries.length === expectedEntries.length &&
    actualEntries.every(
      ([key, value], index) =>
        expectedEntries[index]?.[0] === key && expectedEntries[index]?.[1] === value
    )
  );
};

const main = async () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.collection("timesheetentries");

  const duplicateGroups = await collection
    .aggregate([
      {
        $group: {
          _id: { userId: "$userId", projectId: "$projectId", workDate: "$workDate" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 20 },
    ])
    .toArray();

  if (duplicateGroups.length) {
    console.error(
      "Migration stopped: duplicate user/project/date entries must be consolidated first."
    );
    console.error(JSON.stringify(duplicateGroups, null, 2));
    process.exitCode = 1;
    return;
  }

  const indexes = await collection.indexes();
  const detailDateKeys = { userId: 1, detailId: 1, workDate: 1 };
  const projectDateKeys = { userId: 1, projectId: 1, workDate: 1 };

  for (const index of indexes) {
    if (sameKeys(index.key, detailDateKeys)) {
      await collection.dropIndex(index.name);
      console.log(`Dropped legacy index ${index.name}`);
    }

    if (sameKeys(index.key, projectDateKeys) && index.unique !== true) {
      await collection.dropIndex(index.name);
      console.log(`Dropped non-unique project/date index ${index.name}`);
    }
  }

  await collection.createIndex(projectDateKeys, {
    unique: true,
    name: "userId_1_projectId_1_workDate_1",
  });
  console.log("Timesheet v1 project-hours index migration completed");
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
