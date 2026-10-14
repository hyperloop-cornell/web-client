/** Display formatting shared by every page. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** "5 devices", "1 device". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Compact duration: "42s", "17m", "3h 12m". */
export function duration(ms: number): string {
  if (ms < MINUTE) return `${Math.max(1, Math.round(ms / SECOND))}s`;
  const minutes = Math.floor(ms / MINUTE);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** Relative time in words, like date-fns formatDistanceToNow with a suffix. */
export function ago(ms: number): string {
  const seconds = ms / SECOND;
  const minutes = Math.round(seconds / 60);
  const text =
    seconds < 30
      ? 'less than a minute'
      : seconds < 90
        ? '1 minute'
        : minutes < 45
          ? `${minutes} minutes`
          : minutes < 90
            ? 'about 1 hour'
            : minutes < 1440
              ? `about ${Math.round(minutes / 60)} hours`
              : plural(Math.round(minutes / 1440), 'day');
  return `${text} ago`;
}

/** Milliseconds since an ISO timestamp, or null when it is missing or invalid. */
export function msSince(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.max(0, now - t) : null;
}

export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1000).toFixed(1)} kB`;
  return `${(n / 1e6).toFixed(2)} MB`;
}

/** 24-hour wall clock, "14:03:27". */
export function clock(ts: number | string | Date): string {
  return new Date(ts).toLocaleTimeString('en-GB', { hour12: false });
}

/** Sensor readout: one decimal from 10 up, two below, an em dash when missing. */
export function reading(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
}

/** "hubId:portId" key used by every store. */
export function deviceKey(hubId: string, portId: string): string {
  return `${hubId}:${portId}`;
}

export function splitKey(key: string): { hubId: string; portId: string } {
  const i = key.indexOf(':');
  return { hubId: key.slice(0, i), portId: key.slice(i + 1) };
}
