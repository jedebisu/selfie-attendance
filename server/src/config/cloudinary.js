const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const isConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

async function uploadPhoto(filePath) {
  const result = await cloudinary.uploader.upload(filePath, {
    folder: 'selfie-attendance',
    resource_type: 'image'
  });
  return result.secure_url;
}

module.exports = { cloudinary, isConfigured, uploadPhoto };