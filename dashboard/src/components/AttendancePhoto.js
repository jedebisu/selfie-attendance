import { useEffect, useState } from 'react';
import { photoUrl } from '../services/api';

// Renders an attendance photo with graceful fallbacks:
// - resolves both absolute Cloudinary URLs and legacy relative /uploads/ paths
// - shows a clean placeholder (never the browser broken-image icon) when the
//   record genuinely has no photo (e.g. auto clock-out) or the file fails to load
export default function AttendancePhoto({ url, className = '', alt = '' }) {
  const resolved = photoUrl(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [resolved]);

  if (!resolved || failed) {
    return (
      <div className={`photo-placeholder ${className}`} role="img" aria-label="No photo available">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        <span>No photo</span>
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
