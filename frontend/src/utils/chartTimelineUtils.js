/** Real finalized scores only (TBA uses -1 as placeholder). */
export function matchHasScores(m) {
  if (m.red_score == null || m.blue_score == null) return false;
  if (m.red_score < 0 || m.blue_score < 0) return false;
  return true;
}

function finite(v) {
  return v != null && Number.isFinite(Number(v));
}

const COMP_ORDER = { qm: 0, ef: 1, qf: 2, sf: 3, f: 4 };
const COMP_LABELS = { qm: 'Q', ef: 'EF', qf: 'QF', sf: 'SF', f: 'F' };

export function teamEpaFromMatch(match, teamKey) {
  if (!teamKey || !match) return null;
  if (match.red_teams?.includes(teamKey)) {
    const v = match.red_epa_by_team?.[teamKey];
    return finite(v) ? Number(v) : null;
  }
  if (match.blue_teams?.includes(teamKey)) {
    const v = match.blue_epa_by_team?.[teamKey];
    return finite(v) ? Number(v) : null;
  }
  return null;
}

function matchShortLabel(match) {
  const p = COMP_LABELS[match.comp_level] || match.comp_level || '?';
  if (match.comp_level === 'qm') return `${p}${match.match_number}`;
  return `${p}${match.set_number}-${match.match_number}`;
}

function shortEventLabel(name, eventKey) {
  const raw = (name && String(name).trim()) || eventKey || 'Event';
  return raw.length > 18 ? `${raw.slice(0, 16)}…` : raw;
}

/** Sort matches within one event (time when present, else comp level / set / number). */
export function sortTeamEventMatches(a, b) {
  const ta = a.time ? new Date(a.time).getTime() : NaN;
  const tb = b.time ? new Date(b.time).getTime() : NaN;
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
  if (Number.isFinite(ta) && !Number.isFinite(tb)) return -1;
  if (!Number.isFinite(ta) && Number.isFinite(tb)) return 1;
  const ca = COMP_ORDER[a.comp_level] ?? 99;
  const cb = COMP_ORDER[b.comp_level] ?? 99;
  if (ca !== cb) return ca - cb;
  const sa = a.set_number || 0;
  const sb = b.set_number || 0;
  if (sa !== sb) return sa - sb;
  return (a.match_number || 0) - (b.match_number || 0);
}

/**
 * One row per played match (team on field, scores finalized) with model total EPA snapshot for that match.
 */
export function buildPerMatchChartRows(teamKey, metrics, eventMatches, eventInfos) {
  if (!teamKey || !metrics?.length) return [];
  const rows = [];
  for (const met of metrics) {
    const ek = met.event_key;
    const list = eventMatches?.[ek] || [];
    const info = eventInfos?.[ek];
    const name = info?.name || ek;
    const evShort = shortEventLabel(name, ek);
    const sorted = [...list].sort(sortTeamEventMatches);
    for (const m of sorted) {
      if (!matchHasScores(m)) continue;
      const onField =
        m.red_teams?.includes(teamKey) || m.blue_teams?.includes(teamKey);
      if (!onField) continue;
      const epaTotal = teamEpaFromMatch(m, teamKey);
      if (epaTotal == null) continue;
      const mlabel = matchShortLabel(m);
      rows.push({
        order: rows.length + 1,
        label: `${evShort} ${mlabel}`,
        fullLabel: `${name} · ${mlabel}`,
        eventKey: ek,
        matchKey: m.key,
        epaTotal,
        epaDefenseAdj: null,
        epaAuto: null,
        epaTeleop: null,
        epaEndgame: null,
        consistency: null,
        reliability: null,
        sos: null,
        matchesPlayed: 1,
      });
    }
  }
  return rows;
}

function attachEventKeys(eventMatches) {
  const byKey = new Map();
  if (!eventMatches) return byKey;
  for (const [ek, list] of Object.entries(eventMatches)) {
    for (const m of list || []) {
      if (!m?.key) continue;
      if (!byKey.has(m.key)) {
        byKey.set(m.key, { ...m, event_key: ek });
      }
    }
  }
  return byKey;
}

/**
 * Chronological union of played matches involving either team; epaA/epaB from per-match prediction snapshots.
 */
export function buildComparePerMatchRows(teamKeyA, teamKeyB, eventMatchesA, eventMatchesB, infosA, infosB) {
  if (!teamKeyA || !teamKeyB) return [];
  const infos = { ...(infosA || {}), ...(infosB || {}) };
  const mapA = attachEventKeys(eventMatchesA);
  const mapB = attachEventKeys(eventMatchesB);
  const unionKeys = new Set([...mapA.keys(), ...mapB.keys()]);
  const candidates = [];
  for (const k of unionKeys) {
    const m = mapA.get(k) || mapB.get(k);
    if (!matchHasScores(m)) continue;
    const aOn = m.red_teams?.includes(teamKeyA) || m.blue_teams?.includes(teamKeyA);
    const bOn = m.red_teams?.includes(teamKeyB) || m.blue_teams?.includes(teamKeyB);
    if (!aOn && !bOn) continue;
    const epaA = teamEpaFromMatch(m, teamKeyA);
    const epaB = teamEpaFromMatch(m, teamKeyB);
    if (epaA == null && epaB == null) continue;
    candidates.push(m);
  }
  candidates.sort(sortTeamEventMatches);
  return candidates.map((m) => {
    const ek = m.event_key;
    const info = infos[ek] || {};
    const name = (info.name && String(info.name).trim()) || ek;
    const evShort = shortEventLabel(name, ek);
    const mlabel = matchShortLabel(m);
    const epaA = teamEpaFromMatch(m, teamKeyA);
    const epaB = teamEpaFromMatch(m, teamKeyB);
    return {
      eventKey: ek,
      sortTime: m.time ? new Date(m.time).getTime() : null,
      label: `${evShort} ${mlabel}`,
      fullLabel: `${name} · ${mlabel}`,
      epaA,
      epaB,
      defA: null,
      defB: null,
      autoA: null,
      autoB: null,
      teleA: null,
      teleB: null,
      endA: null,
      endB: null,
      consA: null,
      consB: null,
      relA: null,
      relB: null,
      sosA: null,
      sosB: null,
      mpA: m.red_teams?.includes(teamKeyA) || m.blue_teams?.includes(teamKeyA) ? 1 : 0,
      mpB: m.red_teams?.includes(teamKeyB) || m.blue_teams?.includes(teamKeyB) ? 1 : 0,
    };
  });
}
