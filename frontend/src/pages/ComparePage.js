import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import CompareCharts, { buildCompareTimeline } from '../components/CompareCharts';
import './ComparePage.css';

const COLOR_A = '#38bdf8';
const COLOR_B = '#a78bfa';

function finite(v) {
  return v != null && Number.isFinite(Number(v));
}

function fmt(v, d = 2) {
  if (!finite(v)) return '—';
  return Number(v).toFixed(d);
}

function fmtDelta(a, b) {
  if (!finite(a) || !finite(b)) return '—';
  const d = Number(a) - Number(b);
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}`;
}

function seasonDerived(metrics) {
  const rows = metrics || [];
  const epaVals = rows.map((m) => m.epa_total).filter((v) => finite(v));
  const defVals = rows.map((m) => m.epa_defense_adjusted).filter((v) => finite(v));
  const lastWithEpa = [...rows].reverse().find((m) => finite(m.epa_total));
  return {
    eventCount: rows.length,
    qualMatches: rows.reduce((s, m) => s + (m.matches_played || 0), 0),
    avgEpa: epaVals.length ? epaVals.reduce((a, b) => a + b, 0) / epaVals.length : null,
    maxEpa: epaVals.length ? Math.max(...epaVals) : null,
    minEpa: epaVals.length ? Math.min(...epaVals) : null,
    avgDef: defVals.length ? defVals.reduce((a, b) => a + b, 0) / defVals.length : null,
    latest: lastWithEpa,
  };
}

function TeamSearchCombo({ label, value, displayNum, onSelect, placeholder, accent }) {
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(-1);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const onChange = useCallback(
    (val) => {
      setQ(val);
      setHl(-1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      const t = val.trim();
      if (!t) {
        setSuggestions([]);
        setOpen(false);
        return;
      }
      debounceRef.current = setTimeout(async () => {
        try {
          const res = await api.searchTeams(t);
          setSuggestions(res);
          setOpen(res.length > 0);
        } catch {
          setSuggestions([]);
          setOpen(false);
        }
      }, 200);
    },
    [],
  );

  const pick = useCallback(
    (team) => {
      onSelect(team.key, team.team_number);
      setQ('');
      setSuggestions([]);
      setOpen(false);
    },
    [onSelect],
  );

  const onKeyDown = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHl((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHl((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && hl >= 0) {
      e.preventDefault();
      pick(suggestions[hl]);
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className="compare-search-field" ref={wrapRef}>
      <span className="compare-search-label">{label}</span>
      {value ? (
        <div className="compare-selected-team">
          <span className="compare-selected-num" style={{ color: accent }}>
            {displayNum}
          </span>
          <button type="button" className="compare-clear-team" onClick={() => onSelect(null, null)}>
            Change
          </button>
        </div>
      ) : (
        <>
          <input
            className="input compare-search-input"
            placeholder={placeholder}
            value={q}
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onKeyDown={onKeyDown}
            autoComplete="off"
          />
          {open && suggestions.length > 0 && (
            <div className="compare-search-dropdown">
              {suggestions.map((t, idx) => (
                <button
                  key={t.key}
                  type="button"
                  className={`compare-search-item ${idx === hl ? 'highlighted' : ''}`}
                  onMouseDown={() => pick(t)}
                  onMouseEnter={() => setHl(idx)}
                >
                  <span className="compare-search-item-num">{t.team_number}</span>
                  <span className="compare-search-item-name">{t.name || 'Unknown'}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function ComparePage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [keyA, setKeyA] = useState(null);
  const [keyB, setKeyB] = useState(null);
  const [numA, setNumA] = useState(null);
  const [numB, setNumB] = useState(null);
  const [bundleA, setBundleA] = useState(null);
  const [bundleB, setBundleB] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2002; y--) years.push(y);

  const runCompare = useCallback(async () => {
    if (!keyA || !keyB || keyA === keyB) return;
    setLoading(true);
    setError(null);
    setBundleA(null);
    setBundleB(null);
    try {
      const [a, b] = await Promise.all([api.getTeamSeason(keyA, year), api.getTeamSeason(keyB, year)]);
      setBundleA(a);
      setBundleB(b);
    } catch (e) {
      setError(e.message || 'Could not load team data.');
    }
    setLoading(false);
  }, [keyA, keyB, year]);

  const statsA = useMemo(() => seasonDerived(bundleA?.metrics), [bundleA]);
  const statsB = useMemo(() => seasonDerived(bundleB?.metrics), [bundleB]);
  const timeline = useMemo(
    () =>
      bundleA && bundleB
        ? buildCompareTimeline(
            bundleA.metrics,
            bundleA.event_infos,
            bundleB.metrics,
            bundleB.event_infos,
          )
        : [],
    [bundleA, bundleB],
  );

  const la = numA != null ? `frc${numA}` : 'A';
  const lb = numB != null ? `frc${numB}` : 'B';

  const latestA = statsA.latest;
  const latestB = statsB.latest;

  const matrixRows = useMemo(() => {
    if (!latestA && !latestB) return [];
    return [
      { k: 'latest_total', name: 'Latest total EPA', a: latestA?.epa_total, b: latestB?.epa_total },
      { k: 'latest_def', name: 'Latest defense-adj. EPA', a: latestA?.epa_defense_adjusted, b: latestB?.epa_defense_adjusted },
      { k: 'latest_auto', name: 'Latest auto EPA', a: latestA?.epa_auto, b: latestB?.epa_auto },
      { k: 'latest_tele', name: 'Latest teleop EPA', a: latestA?.epa_teleop, b: latestB?.epa_teleop },
      { k: 'latest_end', name: 'Latest endgame EPA', a: latestA?.epa_endgame, b: latestB?.epa_endgame },
      { k: 'latest_cons', name: 'Latest consistency (0–1)', a: latestA?.consistency, b: latestB?.consistency },
      { k: 'latest_rel', name: 'Latest reliability (0–1)', a: latestA?.reliability, b: latestB?.reliability },
      { k: 'latest_sos', name: 'Latest strength of schedule', a: latestA?.strength_of_schedule, b: latestB?.strength_of_schedule },
      { k: 'avg_epa', name: 'Season mean total EPA', a: statsA.avgEpa, b: statsB.avgEpa },
      { k: 'avg_def', name: 'Season mean defense-adj. EPA', a: statsA.avgDef, b: statsB.avgDef },
      { k: 'max_epa', name: 'Season peak total EPA', a: statsA.maxEpa, b: statsB.maxEpa },
      { k: 'min_epa', name: 'Season min total EPA', a: statsA.minEpa, b: statsB.minEpa },
      { k: 'events', name: 'Events on timeline', a: statsA.eventCount, b: statsB.eventCount, int: true },
      { k: 'quals', name: 'Qual matches in model', a: statsA.qualMatches, b: statsB.qualMatches, int: true },
    ];
  }, [latestA, latestB, statsA, statsB]);

  const canRun = keyA && keyB && keyA !== keyB;

  return (
    <div className="compare-page ds-page-wide">
      <header className="compare-hero">
        <h1 className="page-title text-gradient">Compare</h1>
        <p className="page-subtitle compare-hero-sub">
          Head-to-head analytics workspace: dual-team EPA regression, defense-adjusted signal, component decomposition,
          model weights, and overlaid season trajectories — same WLS + Gaussian stack as match predictions.
        </p>
      </header>

      <section className="card compare-control-card">
        <div className="compare-control-grid">
          <label className="compare-year-field">
            <span className="compare-year-label">Season</span>
            <select className="select compare-year-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <TeamSearchCombo
            label="Robot A"
            value={keyA}
            displayNum={numA}
            accent={COLOR_A}
            onSelect={(k, n) => {
              setKeyA(k);
              setNumA(n);
            }}
            placeholder="Search team number or name…"
          />
          <TeamSearchCombo
            label="Robot B"
            value={keyB}
            displayNum={numB}
            accent={COLOR_B}
            onSelect={(k, n) => {
              setKeyB(k);
              setNumB(n);
            }}
            placeholder="Search team number or name…"
          />
        </div>
        {keyA === keyB && keyA && <p className="compare-warn">Select two different teams.</p>}
        <div className="compare-actions">
          <button type="button" className="btn btn-primary compare-run-btn" disabled={!canRun || loading} onClick={runCompare}>
            {loading ? 'Loading…' : 'Run comparison'}
          </button>
          {keyA && (
            <Link className="compare-link-out" to={`/team/${keyA}`}>
              Open {numA} profile
            </Link>
          )}
          {keyB && (
            <Link className="compare-link-out" to={`/team/${keyB}`}>
              Open {numB} profile
            </Link>
          )}
        </div>
      </section>

      {error && <div className="error-msg">{error}</div>}

      {bundleA && bundleB && !loading && (
        <>
          <section className="compare-dual-head card">
            <div className="compare-head-col" style={{ borderColor: `${COLOR_A}44` }}>
              <div className="compare-head-badge" style={{ background: `${COLOR_A}22`, color: COLOR_A }}>
                {la}
              </div>
              <h2 className="compare-head-title">{numA}</h2>
              <p className="compare-head-name">{bundleA.team?.name || '—'}</p>
              <p className="compare-head-meta">
                {[bundleA.team?.city, bundleA.team?.state_prov, bundleA.team?.country].filter(Boolean).join(', ') || '—'}
              </p>
            </div>
            <div className="compare-head-vs">vs</div>
            <div className="compare-head-col" style={{ borderColor: `${COLOR_B}44` }}>
              <div className="compare-head-badge" style={{ background: `${COLOR_B}22`, color: COLOR_B }}>
                {lb}
              </div>
              <h2 className="compare-head-title">{numB}</h2>
              <p className="compare-head-name">{bundleB.team?.name || '—'}</p>
              <p className="compare-head-meta">
                {[bundleB.team?.city, bundleB.team?.state_prov, bundleB.team?.country].filter(Boolean).join(', ') || '—'}
              </p>
            </div>
          </section>

          <section className="compare-kpi-row">
            <div className="compare-kpi card">
              <div className="compare-kpi-label">Latest total EPA</div>
              <div className="compare-kpi-values">
                <span style={{ color: COLOR_A }}>{fmt(latestA?.epa_total, 1)}</span>
                <span className="compare-kpi-sep">|</span>
                <span style={{ color: COLOR_B }}>{fmt(latestB?.epa_total, 1)}</span>
              </div>
              <div className="compare-kpi-delta">Δ {fmtDelta(latestA?.epa_total, latestB?.epa_total)}</div>
            </div>
            <div className="compare-kpi card">
              <div className="compare-kpi-label">Latest defense-adj. EPA</div>
              <div className="compare-kpi-values">
                <span style={{ color: COLOR_A }}>{fmt(latestA?.epa_defense_adjusted, 1)}</span>
                <span className="compare-kpi-sep">|</span>
                <span style={{ color: COLOR_B }}>{fmt(latestB?.epa_defense_adjusted, 1)}</span>
              </div>
              <div className="compare-kpi-delta">Δ {fmtDelta(latestA?.epa_defense_adjusted, latestB?.epa_defense_adjusted)}</div>
            </div>
            <div className="compare-kpi card">
              <div className="compare-kpi-label">Season mean total EPA</div>
              <div className="compare-kpi-values">
                <span style={{ color: COLOR_A }}>{fmt(statsA.avgEpa, 1)}</span>
                <span className="compare-kpi-sep">|</span>
                <span style={{ color: COLOR_B }}>{fmt(statsB.avgEpa, 1)}</span>
              </div>
              <div className="compare-kpi-delta">Δ {fmtDelta(statsA.avgEpa, statsB.avgEpa)}</div>
            </div>
          </section>

          <section className="card compare-matrix-card">
            <h2 className="compare-matrix-title">Metric matrix</h2>
            <p className="compare-matrix-sub">
              Row delta = column A − column B (positive favors robot A). Values come from stored{' '}
              <code>team_event_metrics</code> for {year}.
            </p>
            <div className="compare-table-wrap">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th scope="col">Signal</th>
                    <th scope="col" className="compare-th-a">
                      {numA}
                    </th>
                    <th scope="col" className="compare-th-b">
                      {numB}
                    </th>
                    <th scope="col" className="compare-th-d">
                      Δ (A − B)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {matrixRows.map((row) => {
                    const dec = row.k.includes('cons') || row.k.includes('rel') ? 3 : 2;
                    return (
                      <tr key={row.k}>
                        <td>{row.name}</td>
                        <td className="compare-td-a">{row.int ? (row.a ?? '—') : fmt(row.a, dec)}</td>
                        <td className="compare-td-b">{row.int ? (row.b ?? '—') : fmt(row.b, dec)}</td>
                        <td className="compare-td-d">
                          {row.int
                            ? finite(row.a) && finite(row.b)
                              ? String(Number(row.a) - Number(row.b))
                              : '—'
                            : fmtDelta(row.a, row.b)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <CompareCharts timeline={timeline} labelA={String(numA)} labelB={String(numB)} colorA={COLOR_A} colorB={COLOR_B} />
        </>
      )}
    </div>
  );
}
