import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import './LocksPage.css';
import './WcmpLocksPage.css';

function statusLabel(s) {
  const map = {
    completed: 'Completed',
    qualifications: 'Qualifications',
    pre_event: 'Pre-Event',
    in_progress: 'In progress',
  };
  return map[s] || s;
}

function isImpactTeam(t) {
  return t.status === 'impact' || t.lock_display === 'Impact' || t.wcmp_lock_display === 'Impact';
}

/** FRCLocks-style: % with one decimal, 0%, —, or Impact */
function formatLocked(t) {
  if (isImpactTeam(t)) return 'Impact';
  const p = t.wcmp_lock_probability;
  if (p == null || !Number.isFinite(p)) return '—';
  if (p < 1e-9) {
    const e1 = t.event_1_pts ?? 0;
    const e2 = t.event_2_pts ?? 0;
    if (e1 > 0 && e2 > 0) return '—';
    return '0%';
  }
  return `${(p * 100).toFixed(1)}%`;
}

function sortTeamsByDistrictRank(teams) {
  if (!teams?.length) return [];
  return [...teams].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
}

export default function WcmpLocksPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [districts, setDistricts] = useState([]);
  const [districtKey, setDistrictKey] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(true);
  const [error, setError] = useState(null);

  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2002; y--) years.push(y);

  const districtTitle = useMemo(() => {
    const d = districts.find((x) => x.key === districtKey);
    return d?.name || data?.district_key || 'District';
  }, [districts, districtKey, data?.district_key]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingDistricts(true);
      setError(null);
      try {
        const d = await api.getDistrictsForLocks(year);
        if (!cancelled) {
          setDistricts(d);
          if (d.length) {
            setDistrictKey((prev) => {
              if (prev && d.some((x) => x.key === prev)) return prev;
              const pnw = d.find((x) => (x.abbrev || '').toLowerCase() === 'pnw');
              return (pnw || d[0]).key;
            });
          } else {
            setDistrictKey('');
            setError('No districts returned for this season on the API (check TBA_API_KEY on the server if unexpected).');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setDistricts([]);
          setDistrictKey('');
          setError(e.message || 'Could not load the district list.');
        }
      }
      setLoadingDistricts(false);
    })();
    return () => { cancelled = true; };
  }, [year]);

  const loadLocks = useCallback(async () => {
    if (!districtKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDistrictLocks(districtKey, year);
      setData(res);
    } catch (e) {
      setError(e.message);
      setData(null);
    }
    setLoading(false);
  }, [districtKey, year]);

  useEffect(() => {
    if (districtKey) loadLocks();
  }, [districtKey, year, loadLocks]);

  const rankedTeams = useMemo(() => sortTeamsByDistrictRank(data?.teams), [data?.teams]);

  const wcmpSlots = data?.wcmp_allocated_slots ?? data?.wcmp_merit_sim_spots ?? 0;

  const dcmpEventRows = useMemo(() => {
    if (!data) return [];
    const pts = data.estimated_points_remaining_hint ?? 0;
    const field = data.dcmp_spots ?? '—';
    const dcmpEv = (data.events || []).filter((e) => e.is_district_cmp);
    if (dcmpEv.length === 0) {
      return [
        {
          key: 'dcmp-synthetic',
          name: 'District Championship',
          status: 'pre_event',
          teamCol: field,
          pts,
          eventKey: null,
        },
      ];
    }
    return dcmpEv.map((ev) => ({
      key: ev.event_key,
      name: ev.name || 'District Championship',
      status: ev.status,
      teamCol: field,
      pts,
      eventKey: ev.event_key,
    }));
  }, [data]);

  return (
    <div className="wcmp-locks-page ds-page">
      <div className="card locks-controls">
        <div className="locks-control-row">
          <label>
            Season
            <select value={year} onChange={(e) => { setYear(Number(e.target.value)); setDistrictKey(''); }}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            District
            <select
              value={districtKey}
              onChange={(e) => setDistrictKey(e.target.value)}
              disabled={loadingDistricts || !districts.length}
            >
              {!districts.length && <option value="">Loading…</option>}
              {districts.map((d) => (
                <option key={d.key} value={d.key}>{d.name || d.key}</option>
              ))}
            </select>
          </label>
          <button type="button" className="btn btn-secondary" onClick={loadLocks} disabled={loading}>
            Refresh
          </button>
        </div>
        <p className="ds-controls-hint">
          <Link to="/locks">District locks</Link>
          {' · '}
          Monte Carlo lock % for FIRST Championship (merit path); not official.
        </p>
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading && <div className="loading">Loading district data…</div>}

      {data && !loading && (
        <>
          <header className="ds-page-hero">
            <h1 className="page-title ds-page-hero-title text-gradient">{districtTitle}</h1>
          </header>

          <section className="ds-section">
            <h2 className="ds-section-title">Statistic</h2>
            <table className="ds-kv-table">
              <tbody>
                <tr>
                  <th scope="row">Points Remaining in the District</th>
                  <td>{data.estimated_points_remaining_hint ?? '—'}</td>
                </tr>
                <tr>
                  <th scope="row">Available World Champs Spots</th>
                  <td>{data.wcmp_allocated_slots ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </section>

          <section className="ds-section">
            <h2 className="ds-section-title">Events</h2>
            <div className="ds-table-wrap">
              <table className="ds-data-table ds-zebra">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Status</th>
                    <th className="ds-num"># Teams</th>
                    <th className="ds-num">Pts Available</th>
                  </tr>
                </thead>
                <tbody>
                  {dcmpEventRows.map((row) => (
                    <tr key={row.key}>
                      <td>
                        {row.eventKey ? (
                          <Link to={`/event/${row.eventKey}`}>{row.name}</Link>
                        ) : (
                          row.name
                        )}
                      </td>
                      <td>{statusLabel(row.status)}</td>
                      <td className="ds-num">{row.teamCol}</td>
                      <td className="ds-num">{row.pts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="ds-section">
            <h2 className="ds-section-title">District Rankings</h2>
            <div className="ds-table-wrap">
              <table className="ds-data-table ds-zebra wcmp-rankings-table">
                <thead>
                  <tr>
                    <th className="ds-num">Rank</th>
                    <th>Team</th>
                    <th className="ds-num" title="Qualification points from district events (two plays)">Districts</th>
                    <th className="ds-num" title="TBA adjustments + rookie bonus">Age Bonus</th>
                    <th className="ds-num" title="Points earned at District Championship">DCMP</th>
                    <th className="ds-num">Total</th>
                    <th className="ds-num" title="Simulated merit-path lock for World Championship">Locked?</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedTeams.map((t) => {
                    const dq = t.district_qual_points;
                    const districtsCol = dq != null ? dq : (t.event_1_pts ?? 0) + (t.event_2_pts ?? 0);
                    const ageB = t.age_bonus != null
                      ? t.age_bonus
                      : (t.age_adjustment ?? 0) + (t.rookie_bonus ?? 0);
                    const dcmpP = t.dcmp_points ?? 0;
                    const inSlotBand = wcmpSlots > 0 && t.rank != null && t.rank <= wcmpSlots;
                    return (
                      <tr
                        key={t.team_key}
                        className={inSlotBand ? 'wcmp-row-slot-band' : undefined}
                      >
                        <td className="ds-num">{t.rank ?? '—'}</td>
                        <td className="ds-mono">
                          <Link to={`/team/${t.team_key}`}>{t.team_key}</Link>
                        </td>
                        <td className="ds-num">{districtsCol}</td>
                        <td className="ds-num">{ageB}</td>
                        <td className="ds-num">{dcmpP}</td>
                        <td className="ds-num wcmp-total">{t.point_total ?? 0}</td>
                        <td className="ds-num wcmp-locked">{formatLocked(t)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <p className="ds-disclaimer">{data.disclaimer}</p>

          <footer className="ds-page-footer">
            <p className="ds-page-footer-brand">Predictobics</p>
            <p className="ds-page-footer-line">
              Layout inspired by classic district lock tools · Algorithm: Monte Carlo on district points (TBA)
            </p>
            <p className="ds-page-footer-line">
              Data from{' '}
              <a href="https://www.thebluealliance.com/" target="_blank" rel="noreferrer">The Blue Alliance</a>
              {' · '}
              <a href="https://www.firstinspires.org/" target="_blank" rel="noreferrer">FIRST</a>
              {' '}is a registered trademark of FIRST.
            </p>
          </footer>
        </>
      )}
    </div>
  );
}
