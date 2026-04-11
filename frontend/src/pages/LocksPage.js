import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { sortLocksTeams, rowClass, LockPctCell } from './locksCommon';
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
    <div className="locks-page ds-page-wide">
      <div className="locks-hero">
        <h1 className="page-title text-gradient">District locks</h1>
        <p className="page-subtitle">
          Two independent estimates from the same district points: DCMP is making your district’s District
          Championship field. WCMP is a separate merit-path snapshot for FIRST Championship (Houston) — different
          cutoff, not the next round after DCMP. Data from The Blue Alliance; not EPA.
        </p>
        <p className="locks-pnw-predict-link">
          <Link to="/locks/wcmp">FIRST Championship view (WCMP-focused table)</Link>
        </p>
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
              <div className="locks-summary-seghead">District Championship (DCMP)</div>
              <div>
                <span className="lbl">DCMP field size (est.)</span>
                <span className="val" title="Estimated teams at your district’s District Championship — used only for the DCMP lock % column">
                  {data.dcmp_spots}
                </span>
              </div>
              <div className="locks-summary-seghead">FIRST Championship (WCMP)</div>
              <div>
                <span className="lbl">WCMP slots (district allocation)</span>
                <span
                  className="val"
                  title="Total Houston slots assigned to this district (all qualification paths). WCMP lock % uses a separate merit-line simulation."
                >
                  {data.wcmp_allocated_slots ?? '—'}
                </span>
              </div>
              <div>
                <span className="lbl">WCMP merit-line rank cutoff (sim)</span>
                <span
                  className="val"
                  title="Merit sim: top k by district points after reserving Impact winners (from TBA) plus 3 slots for the DCMP winning alliance. Override via API: wcmp_merit_sim_spots."
                >
                  {data.wcmp_merit_line_rank_cutoff ?? data.wcmp_merit_sim_spots ?? '—'}
                  {(data.wcmp_non_merit_slots_reserved ?? 0) > 0 && (
                    <span className="locks-subval">
                      reserve {data.wcmp_non_merit_slots_reserved} (
                      {(data.wcmp_impact_slots_reserved ?? 0) > 0 && (
                        <>{data.wcmp_impact_slots_reserved} Impact@DCMP</>
                      )}
                      {(data.wcmp_impact_slots_reserved ?? 0) > 0 && (data.wcmp_dcmp_winner_slots_reserved ?? 0) > 0 && ', '}
                      {(data.wcmp_dcmp_winner_slots_reserved ?? 0) > 0 && (
                        <>{data.wcmp_dcmp_winner_slots_reserved} DCMP winners</>
                      )}
                      ) from allocation {data.wcmp_merit_sim_spots ?? '—'}
                    </span>
                  )}
                </span>
              </div>
              <div className="locks-summary-seghead">District season (shared inputs)</div>
              <div>
                <span className="lbl">Impact winners on district week events (eligible at DCMP)</span>
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
                  <span className="val" title="Wider while district events are still open (applies to both DCMP and WCMP sims)">
                    ×{Number(data.lock_uncertainty_multiplier).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
            <p className="locks-disclaimer">{data.disclaimer}</p>
          </div>

          <div className="card">
            <div className="card-header">District events</div>
            <div className="ds-table-wrap">
              <table className="locks-table ds-data-table">
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
            <div className="card-header">District rankings — DCMP vs WCMP columns</div>
            <div className="locks-legend">
              <span><span className="lg top50" /> Top 50 by DCMP lock % (Impact first)</span>
              <span><span className="lg clinched" /> ≥~97% sim.</span>
              <span><span className="lg in-range" /> In range</span>
              <span><span className="lg bubble" /> Bubble</span>
              <span><span className="lg out" /> Out</span>
              <span><span className="lg impact" /> Impact Award</span>
            </div>
            <div className="ds-table-wrap">
              <table className="locks-table locks-table-wide ds-data-table">
                <thead>
                  <tr>
                    <th title="TBA district points ranking">Dist. rank</th>
                    <th>Team</th>
                    <th>Event 1</th>
                    <th>Event 2</th>
                    <th>Age / adj.</th>
                    <th>Rookie</th>
                    <th>Total</th>
                    <th title="P(estimated District Championship field) — district event, not Houston">DCMP lock %</th>
                    <th title="Separate: merit-path snapshot for FIRST Championship (Houston), different cutoff than DCMP">WCMP lock %</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeams.map((t, index) => (
                    <tr key={t.team_key} className={rowClass(t.status, index)}>
                      <td>{t.rank ?? index + 1}</td>
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
