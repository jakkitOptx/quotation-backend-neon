const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const normalizeFolder = (folder = "") =>
  folder
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

const sanitizeFileName = (fileName = "receipt") =>
  fileName.replace(/[^a-zA-Z0-9._-]/g, "-");

const buildS3Url = (bucket, region, key) =>
  `https://${bucket}.s3.${region}.amazonaws.com/${key}`;

const extractS3KeyFromUrl = (value = "") => {
  if (!value) return "";

  if (!/^https?:\/\//i.test(value)) {
    return value.replace(/^\/+/, "");
  }

  try {
    const parsed = new URL(value);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  } catch (error) {
    return "";
  }
};

const uploadBufferToS3 = async ({
  bucket,
  folder = "",
  fileName,
  buffer,
  contentType,
}) => {
  const cleanFolder = normalizeFolder(folder);
  const keyPrefix = cleanFolder ? `${cleanFolder}/` : "";
  const key = `${keyPrefix}${Date.now()}-${sanitizeFileName(fileName)}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return {
    key,
    url: buildS3Url(bucket, process.env.AWS_REGION, key),
  };
};

const generateSignedS3Url = async ({
  bucket,
  key,
  expiresIn = Number(process.env.AWS_SIGNED_URL_EXPIRES_IN || 3600),
}) => {
  const cleanKey = extractS3KeyFromUrl(key);

  if (!cleanKey) {
    throw new Error("Receipt key is required");
  }

  const signedUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
    }),
    { expiresIn }
  );

  return {
    key: cleanKey,
    url: signedUrl,
    expiresIn,
  };
};

module.exports = {
  s3,
  uploadBufferToS3,
  buildS3Url,
  extractS3KeyFromUrl,
  generateSignedS3Url,
};
