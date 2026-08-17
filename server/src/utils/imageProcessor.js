const sharp = require('sharp');
const path = require('path');

/**
 * Process attendance photo by adding timestamp and GPS overlay
 */
const processAttendancePhoto = async ({
  inputPath,
  outputPath,
  timestamp,
  latitude,
  longitude,
  locationName
}) => {
  try {
    // Get image metadata
    const metadata = await sharp(inputPath).metadata();
    const width = metadata.width;
    const height = metadata.height;

    // Prepare text overlays
    const dateStr = timestamp.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit'
    });
    const timeStr = timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });

    let locationLine = '';
    if (latitude && longitude) {
      locationLine = `📍 ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
    if (locationName) {
      locationLine = `📍 ${locationName}`;
    }

    const overlayHeight = locationLine ? 110 : 80;

    const overlaySvg = `
      <svg width="${width}" height="${overlayHeight}">
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:rgba(0,0,0,0.75);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
          </linearGradient>
        </defs>
        <rect width="260" height="${overlayHeight}" fill="url(#gradient)" rx="8"/>
        <text x="16" y="32" font-family="Arial, sans-serif" font-size="22" fill="white" font-weight="bold">
          ${dateStr}
        </text>
        <text x="16" y="60" font-family="Arial, sans-serif" font-size="20" fill="#4CAF50" font-weight="bold">
          ${timeStr}
        </text>
        ${locationLine ? `<text x="16" y="88" font-family="Arial, sans-serif" font-size="16" fill="white">${locationLine}</text>` : ''}
      </svg>
    `;

    // Process image - single overlay at lower left
    let image = sharp(inputPath);

    image = image.composite([{
      input: Buffer.from(overlaySvg),
      top: height - overlayHeight - 16,
      left: 0
    }]);

    // Save processed image
    await image
      .jpeg({ quality: 90 })
      .toFile(outputPath);

    console.log('Photo processed successfully:', outputPath);
    return outputPath;
  } catch (error) {
    console.error('Error processing photo:', error);
    throw error;
  }
};

/**
 * Create a thumbnail for dashboard display
 */
const createThumbnail = async (inputPath, outputPath, size = 200) => {
  try {
    await sharp(inputPath)
      .resize(size, size, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(outputPath);
    
    return outputPath;
  } catch (error) {
    console.error('Error creating thumbnail:', error);
    throw error;
  }
};

module.exports = {
  processAttendancePhoto,
  createThumbnail
};
