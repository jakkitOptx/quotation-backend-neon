import multer from "multer";
import multerS3 from "multer-s3";
import { s3 } from "../utils/s3.js";

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.AWS_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      const fileName = `receipts/${Date.now()}-${file.originalname}`;
      cb(null, fileName);
    },
  }),
});

export default upload;