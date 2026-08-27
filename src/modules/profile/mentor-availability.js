'use strict';

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseHm(value, fallbackMinutes) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallbackMinutes;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return fallbackMinutes;
  }
  return hour * 60 + minute;
}

function formatHm(minutes) {
  const m = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function getZonedParts(now, timezone) {
  const tz = timezone || 'Asia/Kolkata';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);
  }
  const weekday = String(parts.find((p) => p.type === 'weekday')?.value || 'Sun');
  const dayMap = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  return {
    day: dayMap[weekday] ?? 0,
    minutes: hour * 60 + minute,
    timezone: tz,
  };
}

function normalizeWindows(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const row of raw.slice(0, 21)) {
    const day = Number(row?.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    const start = parseHm(row?.start, -1);
    const end = parseHm(row?.end, -1);
    if (start < 0 || end < 0 || start === end) continue;
    out.push({
      day,
      start: formatHm(start),
      end: formatHm(end),
    });
  }
  return out;
}

function serializeAvailability(raw) {
  const enabled = Boolean(raw?.enabled);
  const timezone =
    String(raw?.timezone || 'Asia/Kolkata').trim().slice(0, 64) ||
    'Asia/Kolkata';
  const windows = normalizeWindows(raw?.windows || []);
  return {
    enabled,
    timezone,
    windows,
  };
}

/**
 * Soft status for UI badges.
 */
function evaluateAvailability(raw, now = new Date()) {
  const data = serializeAvailability(raw);
  if (!data.enabled || data.windows.length === 0) {
    return {
      ...data,
      status: 'unset',
      label: '',
      nextWindowLabel: '',
    };
  }

  const zoned = getZonedParts(now, data.timezone);
  const active = data.windows.find((w) => {
    if (w.day !== zoned.day) return false;
    const start = parseHm(w.start, 0);
    const end = parseHm(w.end, 0);
    if (start < end) {
      return zoned.minutes >= start && zoned.minutes < end;
    }
    return zoned.minutes >= start || zoned.minutes < end;
  });

  if (active) {
    return {
      ...data,
      status: 'available_now',
      label: 'Available now',
      nextWindowLabel: '',
    };
  }

  for (let offset = 0; offset < 7; offset += 1) {
    const day = (zoned.day + offset) % 7;
    const candidates = data.windows
      .filter((w) => w.day === day)
      .map((w) => ({ ...w, startMin: parseHm(w.start, 0) }))
      .sort((a, b) => a.startMin - b.startMin);

    for (const w of candidates) {
      if (offset === 0 && w.startMin <= zoned.minutes) continue;
      const nextWindowLabel = `${DAY_LABELS[day]} ${w.start} IST`;
      return {
        ...data,
        status: 'next',
        label: `Next: ${nextWindowLabel}`,
        nextWindowLabel,
      };
    }
  }

  return {
    ...data,
    status: 'next',
    label: 'Hours set',
    nextWindowLabel: '',
  };
}

function normalizeAvailabilityInput(body) {
  if (!body || typeof body !== 'object') return null;
  return serializeAvailability({
    enabled: Boolean(body.enabled),
    timezone: body.timezone,
    windows: body.windows,
  });
}

module.exports = {
  DAY_LABELS,
  serializeAvailability,
  evaluateAvailability,
  normalizeAvailabilityInput,
};
