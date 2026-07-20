const mongoose = require("mongoose");

const AnnouncementActionSchema = new mongoose.Schema(
  {
    announcementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
      index: true,
    },
    announcementVersion: {
      type: Number,
      required: true,
      min: 1,
      default: 1,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    username: { type: String, required: true, trim: true },
    action: {
      type: String,
      enum: ["viewed", "dismissed", "acknowledged"],
      required: true,
      index: true,
    },
    pagePath: { type: String, default: "", trim: true },
    actedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

AnnouncementActionSchema.index(
  { announcementId: 1, announcementVersion: 1, userId: 1, action: 1 },
  { unique: true }
);

const AnnouncementActionModel =
  mongoose.models.AnnouncementAction ||
  mongoose.model("AnnouncementAction", AnnouncementActionSchema);

let ensureAnnouncementActionIndexesPromise = null;

const ensureAnnouncementActionIndexes = async () => {
  if (ensureAnnouncementActionIndexesPromise) {
    return ensureAnnouncementActionIndexesPromise;
  }

  ensureAnnouncementActionIndexesPromise = (async () => {
    try {
      await AnnouncementActionModel.collection.dropIndex(
        "announcementId_1_userId_1_action_1"
      );
    } catch (error) {
      const isIndexNotFound =
        error?.codeName === "IndexNotFound" ||
        /index not found/i.test(error?.message || "");

      if (!isIndexNotFound) {
        console.error(
          "Failed to drop legacy announcement action index:",
          error
        );
      }
    }

    try {
      await AnnouncementActionModel.syncIndexes();
    } catch (error) {
      console.error("Failed to sync announcement action indexes:", error);
      throw error;
    }
  })().catch((error) => {
    ensureAnnouncementActionIndexesPromise = null;
    throw error;
  });

  return ensureAnnouncementActionIndexesPromise;
};

module.exports = AnnouncementActionModel;
module.exports.ensureAnnouncementActionIndexes = ensureAnnouncementActionIndexes;
