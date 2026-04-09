import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import './LocksPage.css';

function statusLabel(s) {
  const map = {
    completed: 'Completed',
    qualifications: 'Qualifications',
    pre_event: 'Pre-Event',
    in_progress: 'In progress',
  };
  return map[s] || s;
}

const TOP_GREEN_ROWS = 50;

function isImpactTeam(t) {
  return t.status === 'impact' || t.lock_display === 'Impact';
}

/** Impact teams first (by total points), then everyone else by DCMP lock % (best → worst). */
function sortLocksTeams(teams) {
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

/** Row styling: first TOP_GREEN_ROWS are green; below that use status bands. Impact keeps accent in top band. */
function rowClass(st, index) {
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

function LockPctCell({ t, wcmp = false }) {
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

export default function LocksPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [districts, setDistricts] = useState([]);
  const [districtKey, setDistrictKey] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingDistricts, setLoadingDistricts] = useState(true);
  const [error, setError] = useState(null);

  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2002; y--) years.push(y);

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

  const sortedTeams = useMemo(() => sortLocksTeams(data?.teams), [data?.teams]);

  return (
    <div className="locks-page">
      <div className="locks-hero">
        <h1 className="page-title">District &amp; Championship Locks</h1>
        <p className="page-subtitle">
          DCMP and FIRST Championship (WCMP) merit-path estimates from district points via The Blue Alliance.
          Separate from EPA predictions.
        </p>
        {(districtKey || '').toLowerCase().includes('pnw') && (
          <p className="locks-pnw-predict-link">
            <Link to="/pnw-dcmp">PNW District Championship — EPA rankings &amp; playoff predictions</Link>
          </p>
        )}
      </div>

      <div className="locks-controls card">
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
      </div>

      {error && <div className="error-msg">{error}</div>}
      {loading && <div className="loading">Loading district data…</div>}

      {data && !loading && (
        <>
          <div className="card locks-summary">
            <h2 className="card-header">{data.district_key}</h2>
            <div className="locks-summary-grid">
              <div>
                <span className="lbl">DCMP spots (est.)</span>
                <span className="val">{data.dcmp_spots}</span>
              </div>
              <div>
                <span className="lbl">WCMP merit slots (est.)</span>
                <span className="val" title="Approx. district-points slots to FIRST Championship after typical DCMP awards">
                  {data.wcmp_merit_spots ?? '—'}
                </span>
              </div>
              <div>
                <span className="lbl">Impact Award teams (district events)</span>
                <span className="val">{data.impact_award_count}</span>
              </div>
              <div>
                <span className="lbl">Points remaining (rough hint)</span>
                <span className="val">{data.estimated_points_remaining_hint}</span>
              </div>
              {data.calendar_events_total > 0 && (
                <div>
                  <span className="lbl">District events not finished (TBA)</span>
                  <span className="val">
                    {data.calendar_events_incomplete ?? 0} / {data.calendar_events_total}
                  </span>
                </div>
              )}
              {data.lock_uncertainty_multiplier != null && data.lock_uncertainty_multiplier > 1 && (
                <div>
                  <span className="lbl">Lock sim. uncertainty scale</span>
                  <span className="val" title="Wider while district events are still open">
                    ×{Number(data.lock_uncertainty_multiplier).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <p className="locks-disclaimer">{data.disclaimer}</p>
          </div>

          <div className="card">
            <div className="card-header">District events</div>
            <div className="table-wrapper">
              <table className="locks-table">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Status</th>
                    <th>Teams</th>
                    <th>Impact at event</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.events || []).map((ev) => (
                    <tr key={ev.event_key} className={`ev-status-${ev.status}`}>
                      <td>
                        <Link to={`/event/${ev.event_key}`}>{ev.name}</Link>
                        <span className="ev-key">{ev.event_key}</span>
                      </td>
                      <td>{statusLabel(ev.status)}</td>
                      <td>{ev.team_count || '—'}</td>
                      <td>
                        {ev.impact_winners?.length
                          ? ev.impact_winners.map((t) => t.replace('frc', '')).join(', ')
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Rankings &amp; lock %</div>
            <div className="locks-legend">
              <span><span className="lg top50" /> Top 50 (by lock %, Impact first)</span>
              <span><span className="lg clinched" /> ≥~97% sim.</span>
              <span><span className="lg in-range" /> In range</span>
              <span><span className="lg bubble" /> Bubble</span>
              <span><span className="lg out" /> Out</span>
              <span><span className="lg impact" /> Impact Award</span>
            </div>
            <div className="table-wrapper">
              <table className="locks-table locks-table-wide">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Team</th>
                    <th>Event 1</th>
                    <th>Event 2</th>
                    <th>Age / adj.</th>
                    <th>Rookie</th>
                    <th>Total</th>
                    <th>DCMP lock %</th>
                    <th title="Approx. merit-based FIRST Championship path via district points">WCMP lock %</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeams.map((t, index) => (
                    <tr key={t.team_key} className={rowClass(t.status, index)}>
                      <td>{index + 1}</td>
                      <td>
                        <Link to={`/team/${t.team_key}`} className="team-link">
                          <span className="team-num">{t.team_number}</span>
                        </Link>
                      </td>
                      <td>{t.event_1_pts ?? 0}</td>
                      <td>{t.event_2_pts ?? 0}</td>
                      <td>{t.age_adjustment ?? 0}</td>
                      <td>{t.rookie_bonus ?? 0}</td>
                      <td><strong>{t.point_total}</strong></td>
                      <td className="lock-pct-cell">
                        <LockPctCell t={t} />
                      </td>
                      <td className="lock-pct-cell">
                        <LockPctCell t={t} wcmp />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.impact_award_teams?.length > 0 && (
            <div className="card locks-impact-list">
              <div className="card-header">Impact Award winners (tracked)</div>
              <p className="impact-tags">
                {data.impact_award_teams.map((tk) => (
                  <Link key={tk} to={`/team/${tk}`} className="impact-tag">{tk.replace('frc', '')}</Link>
                ))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
