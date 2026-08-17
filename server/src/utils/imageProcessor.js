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

    let locationText = '';
    if (latitude && longitude) {
      locationText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }
    if (locationName) {
      locationText = locationName + (locationText ? ` (${locationText})` : '');
    }

    // Create text overlay SVGs
    const width = metadata.width;
    const height = metadata.height;
    
    // Top banner for timestamp
    const timestampSvg = `
      <svg width="${width}" height="80">
        <defs>
          <linearGradient id="gradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:rgba(0,0,0,0.8);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#gradient)"/>
        <text x="20" y="35" font-family="Arial, sans-serif" font-size="28" fill="white" font-weight="bold">
          ${dateStr}
        </text>
        <text x="20" y="65" font-family="Arial, sans-serif" font-size="24" fill="#4CAF50" font-weight="bold">
          ${timeStr}
        </text>
      </svg>
    `;

    // Bottom banner for location
    const locationSvg = locationText ? `
      <svg width="${width}" height="60">
        <defs>
          <linearGradient id="gradient2" x1="0%" y1="100%" x2="0%" y2="0%">
            <stop offset="0%" style="stop-color:rgba(0,0,0,0.8);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgba(0,0,0,0);stop-opacity:0" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#gradient2)"/>
        <text x="20" y="40" font-family="Arial, sans-serif" font-size="20" fill="white">
          📍 ${locationText}
        </text>
      </svg>
    ` : null;

    // Process image
    let image = sharp(inputPath);

    // Add timestamp overlay
    image = image.composite([{
      input: Buffer.from(timestampSvg),
      top: 0,
      left: 0
    }]);

    // Add location overlay if available
    if (locationSvg) {
      image = image.composite([{
        input: Buffer.from(locationSvg),
        top: height - 60,
        left: 0
      }]);
    }

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
