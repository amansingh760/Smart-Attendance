/**
 * timeUtils.js — single source of truth for time formatting across the app.
 *
 * The backend stores check-in/out as `new Date().toISOString()` which is UTC
 * (ends with "Z"). JavaScript's `new Date(isoString)` correctly converts UTC
 * to the browser's local timezone when you then call `.toLocaleTimeString()`.
 *
 * NEVER extract hours/minutes with a regex from a UTC string — that reads the
 * raw UTC digits and ignores the timezone offset, showing the wrong time.
 *
 * Naive strings (no Z, from manual edits like "2024-01-15T09:30:00") are also
 * handled correctly by `new Date()` — JS treats them as local time.
 */

/**
 * Format any ISO string (UTC or naive local) to a locale-aware time string.
 * e.g. "2024-04-23T09:30:00.000Z" → "3:00 PM" in IST (UTC+5:30)
 */
export function fmtTime(isoStr) {
  if (!isoStr) return '—';
  try {
    return new Date(isoStr).toLocaleTimeString('en-IN', {
      hour:   '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return '—';
  }
}

/**
 * Format duration between two ISO strings.
 * Uses actual Date objects so UTC offsets cancel out correctly.
 */
export function fmtDuration(checkIn, checkOut) {
  if (!checkIn || !checkOut) return '—';
  try {
    const mins = Math.round((new Date(checkOut) - new Date(checkIn)) / 60000);
    if (isNaN(mins) || mins < 0) return '—';
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  } catch {
    return '—';
  }
}

/**
 * Format minutes count into "Xh Ym" string.
 * Used in monthly report where working minutes are pre-calculated.
 */
export function fmtMins(mins) {
  if (!mins || mins <= 0) return '0h 0m';
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Parse an ISO string (UTC or naive) to an "HH:MM" string suitable
 * for a <input type="time"> value — uses LOCAL time.
 */
export function toTimeInput(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

/**
 * Check whether a given ISO timestamp is "late" relative to workStartTime + graceMinutes.
 * Compares LOCAL hours/minutes.
 */
export function isLateTime(isoStr, workStartTime = '09:00', graceMinutes = 15) {
  if (!isoStr) return false;
  try {
    const d = new Date(isoStr);
    const localMins = d.getHours() * 60 + d.getMinutes();
    const [sh, sm] = workStartTime.split(':').map(Number);
    return localMins > (sh * 60 + sm + graceMinutes);
  } catch {
    return false;
  }
}
