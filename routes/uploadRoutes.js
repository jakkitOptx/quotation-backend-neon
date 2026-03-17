const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require("../middlewares/authMiddleware");
const { v2: cloudinary } = require('../utils/cloudinary');
const streamifier = require('streamifier');
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
    files: 5,
  },
  fileFilter: (req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }

    cb(new Error("Unsupported file type"));
  },
});

const pickReceiptFiles = (req) => {
  const files = req.files || [];
  const matchedFiles = files.filter((file) =>
    ["receipt", "receipts", "file", "files", "tollReceipt", "tollReceipts"].includes(
      file.fieldname
    )
  );

  return (matchedFiles.length ? matchedFiles : files).slice(0, 5);
};

router.post('/signature', upload.single('signature'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  try {
    const streamUpload = () => {
      return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            folder: 'signatures',
            allowed_formats: ['jpg', 'jpeg', 'png'],
          },
          (error, result) => {
            if (result) {
              resolve(result);
            } else {
              reject(error);
            }
          }
        );

        streamifier.createReadStream(req.file.buffer).pipe(stream);
      });
    };

    const result = await streamUpload();
    res.status(200).json({ message: 'Upload successful', url: result.secure_url });
  } catch (err) {
    console.error('Cloudinary Upload Error:', err);
    res.status(500).json({ message: 'Upload failed', error: err.message });
  }
});

router.post("/receipt", upload.any(), async (req, res) => {
  const files = pickReceiptFiles(req);

  if (!files.length) {
    return res.status(400).json({ message: "No receipt files uploaded" });
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

    const uploadedFiles = await Promise.all(
      files.map((file) =>
        uploadBufferToS3({
          bucket,
          folder,
          fileName: file.originalname,
          buffer: file.buffer,
          contentType: file.mimetype,
        }).then((result) => ({
          fieldName: file.fieldname,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          key: result.key,
          url: result.url,
        }))
      )
    );

    return res.status(200).json({
      message: "Receipt files uploaded successfully",
      data: {
        totalFiles: uploadedFiles.length,
        files: uploadedFiles,
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
    const requestedKey = req.body?.key || req.query?.key || req.body?.url || req.query?.url;

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

// POST /api/upload/delete
router.post("/delete", async (req, res) => {
  try {
    const { public_id } = req.body; // 👈 ส่งมาใน body เช่น "signatures/ชื่อไฟล์"
    const result = await cloudinary.uploader.destroy(public_id);
    return res.status(200).json({
      message: "Deleted successfully",
      result,
    });
  } catch (error) {
    console.error("Cloudinary Delete Error:", error);
    return res.status(500).json({ message: "Failed to delete", error });
  }
});

module.exports = router;
