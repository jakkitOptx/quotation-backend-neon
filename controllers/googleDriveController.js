// googleDriveController.js
const { google } = require('googleapis');
const { PassThrough } = require('stream');

const SCOPES = ['https://www.googleapis.com/auth/drive'];

const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
credentials.private_key = credentials.private_key.replace(/\\n/g, '\n'); // แปลง \\n เป็น newline

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

const drive = google.drive({ version: 'v3', auth });

exports.uploadFileToDrive = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    const { originalname: name, mimetype, buffer } = req.file;
    const folderId = '1646DNq8KluToefytIWXSLBc5rAc51fwZ';

    const fileMetadata = {
      name,
      parents: [folderId],
    };

    const media = {
      mimeType: mimetype,
      body: bufferToStream(buffer),
    };

    const response = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id',
    });

    res.status(200).json({
      message: 'File uploaded successfully',
      fileId: response.data.id,
    });
  } catch (error) {
    console.error('Error uploading file:', error.message);
    res.status(500).json({ message: 'Failed to upload file', error: error.message });
  }
};

const bufferToStream = (buffer) => {
  const stream = new PassThrough();
  stream.end(buffer);
  return stream;
};
