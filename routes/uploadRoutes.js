const express = require("express");
const router = express.Router();
const multer = require("multer");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  uploadBufferToS3,
  generateSignedS3Url,
} = require("../utils/s3Client");

const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: Number(process.env.MAX_RECEIPT_FILE_SIZE || 10 * 1024 * 1024),
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      return cb(null, true);
    }

    return cb(new Error("Unsupported file type"));
  },
});

const pickReceiptFile = (req) => {
  const files = req.files || [];

  return (
    files.find((file) =>
      ["receipt", "file", "tollReceipt", "tollReceipts"].includes(
        file.fieldname
      )
    ) || files[0]
  );
};

router.post("/receipt", upload.any(), async (req, res) => {
  const file = pickReceiptFile(req);

  if (!file) {
    return res.status(400).json({ message: "No receipt file uploaded" });
  }

  try {
    const bucket = process.env.AWS_BUCKET;
    const folder =
      process.env.AWS_RECEIPT_FOLDER ||
      process.env.AWS_UPLOAD_FOLDER ||
      "receipts";

    if (!bucket || !process.env.AWS_REGION) {
      return res.status(500).json({
        message: "S3 configuration is incomplete",
      });
    }

    const result = await uploadBufferToS3({
      bucket,
      folder,
      fileName: file.originalname,
      buffer: file.buffer,
      contentType: file.mimetype,
    });

    return res.status(200).json({
      message: "Receipt uploaded successfully",
      data: {
        fieldName: file.fieldname,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        key: result.key,
        url: result.url,
      },
    });
  } catch (error) {
    console.error("S3 receipt upload error:", error);
    return res.status(500).json({
      message: "Receipt upload failed",
      error: error.message,
    });
  }
});

const handleSignedReceiptUrl = async (req, res) => {
  try {
    const bucket = process.env.AWS_BUCKET;
    const requestedKey =
      req.body?.key ||
      req.query?.key ||
      req.body?.url ||
      req.query?.url;

    if (!bucket || !process.env.AWS_REGION) {
      return res.status(500).json({
        message: "S3 configuration is incomplete",
      });
    }

    if (!requestedKey) {
      return res.status(400).json({
        message: "Receipt key or url is required",
      });
    }

    const result = await generateSignedS3Url({
      bucket,
      key: requestedKey,
      expiresIn: Number(req.body?.expiresIn || req.query?.expiresIn || 3600),
    });

    return res.status(200).json({
      message: "Signed receipt url generated successfully",
      data: result,
    });
  } catch (error) {
    console.error("Generate signed receipt url error:", error);
    return res.status(500).json({
      message: "Failed to generate signed receipt url",
      error: error.message,
    });
  }
};

router.get("/receipt/signed-url", authMiddleware, handleSignedReceiptUrl);
router.post("/receipt/signed-url", authMiddleware, handleSignedReceiptUrl);

module.exports = router;