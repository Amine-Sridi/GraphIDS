/**
 * Formatting utilities for displaying data in the UI
 */

/**
 * Convert timestamp to HH:MM:SS format
 */
export const formatTime = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Convert timestamp to MM:SS format (short)
 */
export const formatTimeShort = (d: Date) =>
  d.toLocaleTimeString('en-US', { hour12: false, minute: '2-digit', second: '2-digit' });

/**
 * Convert timestamp to "Mon DD HH:MM:SS" format
 */
export const formatDate = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }) + ' ' + formatTime(d);

/**
 * Format bytes to human-readable size (B, KB, MB)
 */
export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/**
 * Format duration in milliseconds to human-readable string
 */
export const formatDuration = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
};
