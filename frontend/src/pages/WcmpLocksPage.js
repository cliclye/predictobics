import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { sortLocksTeams, rowClass, LockPctCell } from './locksCommon';
import './LocksPage.css';
import './WcmpLocksPage.css';

const FALLBACK_DISCLAIMER =
  'DCMP field sizes and WCMP merit-slot estimates are approximate. Lock % uses Monte Carlo over ' +
  'remaining district week points — not a guarantee. Impact teams show Impact instead of %. ' +
  'Verify with official FIRST / district sources.';

function fullPayloadToBlock(dMeta, full) {
  return {
    district_key: full.district_key,
    name: dMeta.name,
    dcmp_spots: full.dcmp_spots,
    wcmp_merit_spots: full.wcmp_merit_spots,
    calendar_events_incomplete: full.calendar_events_incomplete,
    calendar_events_total: full.calendar_events_total,
    lock_uncertainty_multiplier: full.lock_uncertainty_multiplier,
    teams: full.teams || [],
  };
}

function DistrictLocksSection({ block }) {
  const sorted = React.useMemo(() => sortLocksTeams(block.teams || []), [block.teams]);

  if (block.error) {
    return (
      <section className="card wcmp-district-card">
        <h2 className="card-header wcmp-district-title">{block.name}</h2>
        <p className="error-msg wcmp-district-error">{block.error}</p>
      </section>
    );
  }

  return (
    <section className="card wcmp-district-card">
      <h2 className="card-header wcmp-district-title">{block.name}</h2>
      <div className="wcmp-district-meta">
        <span>
          <span className="lbl">DCMP spots (est.)</span>{' '}
          <span className="val">{block.dcmp_spots}</span>
        </span>
        <span>
          <span className="lbl">WCMP merit slots (est.)</span>{' '}
          <span className="val">{block.wcmp_merit_spots}</span>
        </span>
        {(block.calendar_events_total ?? 0) > 0 && (
          <span>
            <span className="lbl">District week events not finished</span>{' '}
            <span className="val">
              {block.calendar_events_incomplete ?? 0} / {block.calendar_events_total}
            </span>
          </span>
        )}
        {block.lock_uncertainty_multiplier != null && block.lock_uncertainty_multiplier > 1 && (
          <span title="Wider while district events are still open">
            <span className="lbl">Uncertainty scale</span>{' '}
            <span className="val">×{Number(block.lock_uncertainty_multiplier).toFixed(2)}</span>
          </span>
        )}
      </div>
      <div className="locks-legend locks-legend--compact">
        <span><span className="lg top50" /> Top 50 (by DCMP lock %)</span>
        <span><span className="lg clinched" /> ≥~97% sim.</span>
        <span><span className="lg in-range" /> In range</span>
        <span><span className="lg bubble" /> Bubble</span>
        <span><span className="lg out" /> Out</span>
        <span><span className="lg impact" /> Impact</span>
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
            {sorted.map((t, index) => (
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
    </section>
  );
}

const FETCH_CONCURRENCY = 4;

export default function WcmpLocksPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [blocks, setBlocks] = useState([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [disclaimer, setDisclaimer] = useState('');
  const disclaimerCaptured = useRef(false);

  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2002; y--) years.push(y);

  useEffect(() => {
    let cancelled = false;
    disclaimerCaptured.current = false;

    (async () => {
      setLoading(true);
      setListError(null);
      setBlocks([]);
      setProgress({ done: 0, total: 0 });
      setDisclaimer('');

      try {
        const list = await api.getDistrictsForLocks(year);
        if (cancelled) return;
        if (!list.length) {
          setListError('No districts returned for this season.');
          setLoading(false);
          return;
        }

        setProgress({ done: 0, total: list.length });

        const insertSorted = (block) => {
          setBlocks((prev) => {
            const next = [...prev, block];
            next.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
            return next;
          });
        };

        let nextIndex = 0;

        async function worker() {
          for (;;) {
            const i = nextIndex;
            nextIndex += 1;
            if (i >= list.length) break;
            const d = list[i];
            try {
              const full = await api.getDistrictLocks(d.key, year);
              if (cancelled) return;
              if (!disclaimerCaptured.current && full.disclaimer) {
                disclaimerCaptured.current = true;
                setDisclaimer(full.disclaimer);
              }
              insertSorted(fullPayloadToBlock(d, full));
            } catch (e) {
              if (cancelled) return;
              insertSorted({
                district_key: d.key,
                name: d.name,
                error: e.message || 'Failed to load this district.',
                teams: [],
              });
            } finally {
              if (!cancelled) {
                setProgress((p) => ({ ...p, done: p.done + 1 }));
              }
            }
          }
        }

        const nWorkers = Math.min(FETCH_CONCURRENCY, list.length);
        await Promise.all(Array.from({ length: nWorkers }, () => worker()));
      } catch (e) {
        if (!cancelled) setListError(e.message || 'Could not load districts.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [year]);

  const disc = disclaimer || FALLBACK_DISCLAIMER;

  return (
    <div className="locks-page wcmp-locks-page">
      <div className="locks-hero">
        <h1 className="page-title">Locks for WCMP</h1>
        <p className="page-subtitle">
          Each district loads in its own request (several at a time) so the page works behind short API timeouts
          (e.g. Vercel). Tables appear as data arrives.
        </p>
        <p className="locks-pnw-predict-link">
          <Link to="/locks">Single-district locks</Link>
        </p>
      </div>

      <div className="locks-controls card">
        <div className="locks-control-row">
          <label>
            Season
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {listError && <div className="error-msg">{listError}</div>}

      {loading && progress.total > 0 && (
        <div className="loading wcmp-loading wcmp-progress">
          Loading districts… {progress.done} / {progress.total} complete (TBA + server work per district).
        </div>
      )}

      {loading && progress.total === 0 && !listError && (
        <div className="loading wcmp-loading">
          Fetching district list…
        </div>
      )}

      {blocks.length > 0 && (
        <div className="wcmp-district-list">
          {blocks.map((block) => (
            <DistrictLocksSection key={block.district_key} block={block} />
          ))}
        </div>
      )}

      {!loading && !listError && blocks.length === 0 && progress.total === 0 && (
        <div className="loading wcmp-loading">No data.</div>
      )}

      {!loading && progress.total > 0 && !listError && (
        <div className="card locks-summary wcmp-global-disclaimer">
          <p className="locks-disclaimer">{disc}</p>
        </div>
      )}
    </div>
  );
}
