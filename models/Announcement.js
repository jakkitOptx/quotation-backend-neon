const mongoose = require("mongoose");

const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["info", "success", "warning", "error", "maintenance"],
      default: "info",
    },
    status: {
      type: String,
      enum: ["draft", "active", "inactive", "expired"],
      default: "draft",
      index: true,
    },
    priority: { type: Number, default: 0 },
    displayMode: {
      type: String,
      enum: ["popup", "banner"],
      default: "popup",
    },
    version: { type: Number, default: 1, min: 1 },
    publishedAt: { type: Date, default: Date.now },
    audience: {
      showToAll: { type: Boolean, default: true },
      roles: { type: [String], default: [] },
      departments: { type: [String], default: [] },
      userIds: { type: [String], default: [] },
    },
    pages: { type: [String], default: [] },
    startAt: { type: Date, default: null, index: true },
    endAt: { type: Date, default: null, index: true },
    requiresAcknowledgement: { type: Boolean, default: false },
    dismissible: { type: Boolean, default: true },
    showOncePerUser: { type: Boolean, default: false },
    cta: {
      label: { type: String, default: "", trim: true },
      url: { type: String, default: "", trim: true },
    },
    createdBy: { type: String, default: "", trim: true },
    updatedBy: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

AnnouncementSchema.index({ status: 1, displayMode: 1, priority: -1, startAt: 1, endAt: 1 });

module.exports =
  mongoose.models.Announcement ||
  mongoose.model("Announcement", AnnouncementSchema);
