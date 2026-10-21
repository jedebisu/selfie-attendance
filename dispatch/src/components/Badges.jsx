import React from 'react';
import { statusStyle, channelColor } from '../theme';

export { statusStyle, channelColor };

export function StatusBadge({ status }) {
  const s = status || 'default';
  return (
    <span className="status-badge" data-status={s}>
      <span className="dot" />
      {s}
    </span>
  );
}

export function ChannelBadge({ channel }) {
  const c = channel || 'default';
  return (
    <span className="channel-badge" data-channel={c}>
      <span className="dot" />
      {c === 'default' ? 'Unassigned' : c}
    </span>
  );
}
