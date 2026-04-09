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

/** Impact first, then by WCMP lock % (merit-line sim). */
export function sortLocksTeamsByWcmp(teams) {
  if (!teams?.length) return [];
  const impact = teams.filter(isImpactTeam);
  const rest = teams.filter((t) => !isImpactTeam(t));
  impact.sort((a, b) => (b.point_total ?? 0) - (a.point_total ?? 0));
  rest.sort((a, b) => {
    const pa = a.wcmp_lock_probability;
    const pb = b.wcmp_lock_probability;
    if (pa == null && pb == null) return (b.point_total ?? 0) - (a.point_total ?? 0);
    if (pa == null) return 1;
    if (pb == null) return -1;
    if (pb !== pa) return pb - pa;
    return (b.point_total ?? 0) - (a.point_total ?? 0);
  });
  return [...impact, ...rest];
}

/**
 * WCMP table: green band = official district rank within WCMP slot count (not “top 50 by lock %” like DCMP page).
 */
export function rowClassWcmp(t, wcmpRankCutoff) {
  const st = isImpactTeam(t) ? 'impact' : (t.wcmp_status || 'out');
  const r = t.rank;
  const k = wcmpRankCutoff != null && Number(wcmpRankCutoff) > 0 ? Number(wcmpRankCutoff) : null;
  const inAllocationBand = k != null && r != null && r <= k;
  if (inAllocationBand) {
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

/** Row styling: first TOP_GREEN_ROWS are green; below that use status bands. Impact keeps accent in top band. */
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
