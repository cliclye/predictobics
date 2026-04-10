import React from 'react';

export const TOP_GREEN_ROWS = 50;

export function isImpactTeam(t) {
  return t.status === 'impact' || t.lock_display === 'Impact';
}

/** Impact teams first (by total points), then everyone else by DCMP lock % (best → worst). */
export function sortLocksTeams(teams) {
  if (!teams?.length) return [];
  const impact = teams.filter(isImpactTeam);
  const rest = teams.filter((t) => !isImpactTeam(t));
  impact.sort((a, b) => (b.point_total ?? 0) - (a.point_total ?? 0));
  rest.sort((a, b) => {
    const pa = a.lock_probability;
    const pb = b.lock_probability;
    if (pa == null && pb == null) return (b.point_total ?? 0) - (a.point_total ?? 0);
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pb !== pa) return pb - pa;
    return (b.point_total ?? 0) - (a.point_total ?? 0);
  });
  return [...impact, ...rest];
}

/**
 * Sort key for “chance of reaching WCMP”: merit sim probability, or ~certain for Impact qualifiers.
 * Teams with no usable WCMP % sink to the bottom.
 */
function wcmpQualificationSortKey(t) {
  if (isImpactTeam(t)) return 1;
  const p = t.wcmp_lock_probability;
  if (p == null || !Number.isFinite(p)) return -1;
  return p;
}

/** Highest → lowest estimated WCMP qualification chance (merit sim; Impact treated as certain). */
export function sortLocksTeamsByWcmp(teams) {
  if (!teams?.length) return [];
  const copy = [...teams];
  copy.sort((a, b) => {
    const ka = wcmpQualificationSortKey(a);
    const kb = wcmpQualificationSortKey(b);
    const byChance = kb - ka;
    if (byChance !== 0) return byChance;
    const ra = a.rank ?? 1e9;
    const rb = b.rank ?? 1e9;
    if (ra !== rb) return ra - rb;
    return (b.point_total ?? 0) - (a.point_total ?? 0);
  });
  return copy;
}

/**
 * WCMP page only: green band from WCMP-chance sort + Houston slot count — not DCMP field size.
 */
export function rowClassWcmp(t, wcmpRankCutoff, index) {
  const st = isImpactTeam(t) ? 'impact' : (t.wcmp_status || 'out');
  const k = wcmpRankCutoff != null && Number(wcmpRankCutoff) > 0 ? Number(wcmpRankCutoff) : null;
  const inTopSlots = k != null && index != null && index < k;
  if (inTopSlots) {
    const parts = ['lock-row', 'locks-row-top50'];
    if (st === 'impact') parts.push('impact-row');
    return parts.join(' ');
  }
  if (st === 'impact') return 'lock-row impact-row';
  if (st === 'clinched') return 'lock-row clinched';
  if (st === 'in_range') return 'lock-row in-range';
  if (st === 'bubble') return 'lock-row bubble';
  return 'lock-row out';
}

/**
 * District locks page only: row color from DCMP sim bucket (`status`). First TOP_GREEN_ROWS by DCMP sort get the green band.
 */
export function rowClass(st, index) {
  const parts = ['lock-row'];
  if (index < TOP_GREEN_ROWS) {
    parts.push('locks-row-top50');
    if (st === 'impact') parts.push('impact-row');
    return parts.join(' ');
  }
  if (st === 'impact') return 'lock-row impact-row';
  if (st === 'clinched') return 'lock-row clinched';
  if (st === 'in_range') return 'lock-row in-range';
  if (st === 'bubble') return 'lock-row bubble';
  return 'lock-row out';
}

export function LockPctCell({ t, wcmp = false }) {
  const display = wcmp ? t.wcmp_lock_display : t.lock_display;
  const prob = wcmp ? t.wcmp_lock_probability : t.lock_probability;
  if (display === 'Impact') {
    return <strong className="impact-lock-label">Impact</strong>;
  }
  if (prob == null && display !== 'Impact') {
    return <span className="lock-dash">—</span>;
  }
  if (!Number.isFinite(prob)) {
    return <span className="lock-dash">—</span>;
  }
  return <strong>{(prob * 100).toFixed(1)}%</strong>;
}
