const sharp = require('sharp');
const https = require('https');
const http = require('http');

const download = (url) => new Promise((resolve, reject) => {
  const mod = url.startsWith('https') ? https : http;
  mod.get(url, { headers: { 'User-Agent': 'SelfieAttendance/1.0' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      return download(res.headers.location).then(resolve).catch(reject);
    }
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
    res.on('error', reject);
  }).on('error', reject);
});

const latLonToTile = (lat, lon, zoom) => {
  const x = Math.floor((lon + 180) / 360 * Math.pow(2, zoom));
  const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
  return { x, y };
};

const processAttendancePhoto = async ({
  inputPath,
  outputPath,
  timestamp,
  latitude,
  longitude
}) => {
  try {
    const metadata = await sharp(inputPath).metadata();

    // Cap resolution: full-res phone photos (12MP+) are slow to encode AND
    // make the timestamp overlay tiny. 1440px keeps faces clear, makes the
    // evidence overlay more readable, and cuts CPU time ~10x.
    const MAX_DIM = 1440;
    const scale = Math.min(1, MAX_DIM / Math.max(metadata.width, metadata.height));
    const width = Math.round(metadata.width * scale);
    const height = Math.round(metadata.height * scale);

    const dateStr = timestamp.toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: '2-digit'
    });
    const timeStr = timestamp.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });

    const hasCoords = latitude && longitude;
    let mapBuffer = null;
    const mapSize = 120;
    const mapPadding = 12;
    const textX = 16;

    if (hasCoords) {
      try {
        const zoom = 15;
        const tile = latLonToTile(latitude, longitude, zoom);
        const tileUrl = `https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png`;
        const rawTile = await download(tileUrl);

        const tileSize = 256;
        const fracX = ((longitude + 180) / 360 * Math.pow(2, zoom)) - tile.x;
        const fracY = ((1 - Math.log(Math.tan(latitude * Math.PI / 180) + 1 / Math.cos(latitude * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom)) - tile.y;
        const px = Math.floor(fracX * tileSize);
        const py = Math.floor(fracY * tileSize);

        const extractLeft = Math.max(0, Math.min(px - mapSize / 2, tileSize - mapSize));
        const extractTop = Math.max(0, Math.min(py - mapSize / 2, tileSize - mapSize));

        mapBuffer = await sharp(rawTile)
          .resize(tileSize, tileSize)
          .extract({
            left: extractLeft,
            top: extractTop,
            width: mapSize,
            height: mapSize
          })
          .toBuffer();
      } catch (e) {
        console.error('Map tile fetch failed:', e.message);
      }
    }

    const overlayHeight = mapBuffer ? mapSize + mapPadding * 2 : (hasCoords ? 110 : 80);
    const textTop = mapBuffer ? mapSize + mapPadding + 4 : 32;

    let locationLine = '';
    if (hasCoords) {
      locationLine = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    }

    const overlayWidth = mapBuffer ? mapSize + mapPadding * 2 + 140 : 280;

    const safeOverlayTop = Math.max(0, height - overlayHeight - 16);
    const safeOverlayLeft = Math.max(0, Math.min(0, width - overlayWidth));

    let svgContent = `
      <svg width="${overlayWidth}" height="${overlayHeight}">
        <defs>
          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:rgba(0,0,0,0.8);stop-opacity:1" />
            <stop offset="100%" style="stop-color:rgba(0,0,0,0.1);stop-opacity:0" />
          </linearGradient>
        </defs>
        <rect width="${overlayWidth}" height="${overlayHeight}" fill="url(#grad)" rx="8"/>
        <text x="${textX}" y="${textTop}" font-family="Arial, sans-serif" font-size="22" fill="white" font-weight="bold">${dateStr}</text>
        <text x="${textX}" y="${textTop + 28}" font-family="Arial, sans-serif" font-size="20" fill="#4CAF50" font-weight="bold">${timeStr}</text>
    `;

    if (hasCoords) {
      svgContent += `<text x="${textX}" y="${textTop + 56}" font-family="Arial, sans-serif" font-size="14" fill="white">📍 ${locationLine}</text>`;
    }

    svgContent += `</svg>`;

    const composites = [{
      input: Buffer.from(svgContent),
      top: safeOverlayTop,
      left: safeOverlayLeft
    }];

    if (mapBuffer) {
      composites.push({
        input: mapBuffer,
        top: safeOverlayTop + mapPadding,
        left: safeOverlayLeft + mapPadding
      });
    }

    const pipeline = sharp(inputPath).rotate();
    if (scale < 1) pipeline.resize(width, height);
    await pipeline
      .composite(composites)
      .jpeg({ quality: 78 })
      .toFile(outputPath);

    console.log('Photo processed successfully:', outputPath);
    return outputPath;
  } catch (error) {
    console.error('Error processing photo:', error);
    throw error;
  }
};

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

module.exports = { processAttendancePhoto, createThumbnail };
