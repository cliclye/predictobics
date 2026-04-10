/**
 * Match scheduled times from the API are UTC. Serialized ISO strings include a Z
 * suffix; legacy responses may omit a timezone — treat those as UTC, not local.
 */
export function parseMatchTimeUtc(iso) {
  if (iso == null || iso === '') return null;
  const s = String(iso).trim();
  if (!s) return null;
  const hasTz = /[zZ]$/.test(s) || /[+-]\d{2}:\d{2}$/.test(s);
  const d = new Date(hasTz ? s : `${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatMatchScheduleLocal(iso) {
  const d = parseMatchTimeUtc(iso);
  if (!d) return null;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}
