import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import './HomePage.css';

/** Sort key for week labels: Week 0, Week 1, … then Other last. */
function weekLabelSortKey(label) {
  if (label === 'Other') return 10000;
  const m = /^Week (\d+)$/.exec(label);
  return m ? parseInt(m[1], 10) : 5000;
}

function weekLabelForEvent(ev) {
  return ev.week !== null && ev.week !== undefined ? `Week ${ev.week}` : 'Other';
}

function HomePage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamResults, setTeamResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchDebounceRef = useRef(null);
  const dropdownRef = useRef(null);
  const inputRef = useRef(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);

  const [eventQuery, setEventQuery] = useState('');
  const [weekFilter, setWeekFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [viewMode, setViewMode] = useState('table');
  const [openWeeks, setOpenWeeks] = useState(() => new Set());
  const lastOpenedYearRef = useRef(null);

  const navigate = useNavigate();

  useEffect(() => {
    loadEvents();
  }, [year]);

  useEffect(() => {
    lastOpenedYearRef.current = null;
    setEventQuery('');
    setWeekFilter('all');
    setRegionFilter('all');
  }, [year]);

  useEffect(() => {
    if (loading || !events.length) return;
    if (events[0]?.year != null && Number(events[0].year) !== Number(year)) return;
    if (lastOpenedYearRef.current === year) return;
    lastOpenedYearRef.current = year;
    const labels = new Set();
    events.forEach((e) => labels.add(weekLabelForEvent(e)));
    const sorted = [...labels].sort((a, b) => weekLabelSortKey(a) - weekLabelSortKey(b));
    if (sorted.length) {
      setOpenWeeks(new Set([sorted[0]]));
    }
  }, [year, loading, events]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadEvents() {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEvents(year);
      setEvents(data);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  // Live autocomplete: debounce search as user types
  function handleTeamInputChange(val) {
    setTeamSearch(val);
    setHighlightIdx(-1);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const trimmed = val.trim();
    if (!trimmed) {
      setTeamResults([]);
      setShowDropdown(false);
      return;
    }
    searchDebounceRef.current = setTimeout(async () => {
      try {
        setSearching(true);
        const results = await api.searchTeams(trimmed);
        setTeamResults(results);
        setShowDropdown(results.length > 0);
      } catch {
        setTeamResults([]);
        setShowDropdown(false);
      }
      setSearching(false);
    }, 200);
  }

  function handleTeamSelect(teamKey) {
    setShowDropdown(false);
    setTeamSearch('');
    setTeamResults([]);
    navigate(`/team/${teamKey}`);
  }

  function handleTeamSearchKeyDown(e) {
    if (!showDropdown || teamResults.length === 0) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const trimmed = teamSearch.trim();
        if (trimmed.match(/^\d+$/)) {
          navigate(`/team/frc${trimmed}`);
        }
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx(i => Math.min(i + 1, teamResults.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightIdx >= 0 && highlightIdx < teamResults.length) {
        handleTeamSelect(teamResults[highlightIdx].key);
      } else {
        const trimmed = teamSearch.trim();
        if (trimmed.match(/^\d+$/)) {
          navigate(`/team/frc${trimmed}`);
        }
      }
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  }

  async function handleTeamSearch(e) {
    e.preventDefault();
    if (!teamSearch.trim()) return;
    const trimmed = teamSearch.trim();
    if (trimmed.match(/^\d+$/)) {
      navigate(`/team/frc${trimmed}`);
      return;
    }
    setSearching(true);
    try {
      const results = await api.searchTeams(trimmed);
      setTeamResults(results);
      setShowDropdown(results.length > 0);
    } catch {
      setTeamResults([]);
    }
    setSearching(false);
  }

  const filteredEvents = useMemo(() => {
    let list = events;
    const q = eventQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (ev) =>
          (ev.name || '').toLowerCase().includes(q) ||
          (ev.key || '').toLowerCase().includes(q) ||
          (ev.city || '').toLowerCase().includes(q) ||
          (ev.state_prov || '').toLowerCase().includes(q) ||
          (ev.country || '').toLowerCase().includes(q)
      );
    }
    if (weekFilter !== 'all') {
      if (weekFilter === 'other') {
        list = list.filter((ev) => ev.week === null || ev.week === undefined);
      } else {
        const w = Number(weekFilter);
        list = list.filter((ev) => ev.week === w);
      }
    }
    if (regionFilter !== 'all') {
      list = list.filter((ev) => {
        const st = (ev.state_prov || '').trim();
        const co = (ev.country || '').trim();
        if (st) {
          return `${st}|${co || ''}` === regionFilter;
        }
        return co === regionFilter;
      });
    }
    return list;
  }, [events, eventQuery, weekFilter, regionFilter]);

  const grouped = useMemo(() => {
    const g = {};
    filteredEvents.forEach((e) => {
      const label = weekLabelForEvent(e);
      if (!g[label]) g[label] = [];
      g[label].push(e);
    });
    Object.keys(g).forEach((k) => {
      g[k].sort((a, b) => {
        const da = a.start_date ? new Date(a.start_date).getTime() : 0;
        const db = b.start_date ? new Date(b.start_date).getTime() : 0;
        return da - db || (a.name || '').localeCompare(b.name || '');
      });
    });
    return g;
  }, [filteredEvents]);

  const sortedWeekLabels = useMemo(
    () => Object.keys(grouped).sort((a, b) => weekLabelSortKey(a) - weekLabelSortKey(b)),
    [grouped]
  );

  const weekOptions = useMemo(() => {
    const nums = new Set();
    let hasOther = false;
    events.forEach((e) => {
      if (e.week !== null && e.week !== undefined) nums.add(e.week);
      else hasOther = true;
    });
    const opts = [{ value: 'all', label: 'All weeks' }];
    [...nums].sort((a, b) => a - b).forEach((n) => {
      opts.push({ value: String(n), label: `Week ${n}` });
    });
    if (hasOther) opts.push({ value: 'other', label: 'Other / TBD' });
    return opts;
  }, [events]);

  const regionOptions = useMemo(() => {
    const keys = new Map();
    events.forEach((e) => {
      const st = (e.state_prov || '').trim();
      const co = (e.country || '').trim();
      if (st) {
        const k = `${st}|${co || ''}`;
        if (!keys.has(k)) keys.set(k, st + (co ? ` (${co})` : ''));
      } else if (co) {
        if (!keys.has(co)) keys.set(co, co);
      }
    });
    const opts = [{ value: 'all', label: 'All regions' }];
    [...keys.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .forEach(([value, label]) => opts.push({ value, label }));
    return opts;
  }, [events]);

  useEffect(() => {
    const q = eventQuery.trim();
    if (q && sortedWeekLabels.length > 0) {
      setOpenWeeks(new Set(sortedWeekLabels));
    }
  }, [eventQuery, sortedWeekLabels]);

  const toggleWeek = useCallback((label) => {
    setOpenWeeks((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }, []);

  const expandAllWeeks = useCallback(() => {
    setOpenWeeks(new Set(sortedWeekLabels));
  }, [sortedWeekLabels]);

  const collapseAllWeeks = useCallback(() => {
    setOpenWeeks(new Set());
  }, []);

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2002; y--) years.push(y);

  const totalShown = filteredEvents.length;
  const totalAll = events.length;

  return (
    <div className="home-page ds-page-wide">
      <div className="hero-section ds-page-hero">
        <h1 className="page-title ds-page-hero-title">Predictobics</h1>
        <p className="page-subtitle">Advanced FRC analytics with component EPA, defense-adjusted metrics, and ML-powered predictions</p>

        <div className="search-wrapper">
          <form className="search-bar" onSubmit={handleTeamSearch} autoComplete="off">
            <div className="search-input-wrap">
              <input
                ref={inputRef}
                className="input search-input"
                placeholder="Search team number or name..."
                value={teamSearch}
                onChange={(e) => handleTeamInputChange(e.target.value)}
                onFocus={() => { if (teamResults.length > 0) setShowDropdown(true); }}
                onKeyDown={handleTeamSearchKeyDown}
              />
              {searching && <span className="search-spinner" />}
            </div>
            <button className="btn btn-primary" type="submit" disabled={searching}>
              Go
            </button>
          </form>
          {showDropdown && teamResults.length > 0 && (
            <div className="team-dropdown" ref={dropdownRef}>
              {teamResults.map((t, idx) => (
                <button
                  key={t.key}
                  type="button"
                  className={`team-dropdown-item ${idx === highlightIdx ? 'highlighted' : ''}`}
                  onMouseDown={() => handleTeamSelect(t.key)}
                  onMouseEnter={() => setHighlightIdx(idx)}
                >
                  <span className="team-number">{t.team_number}</span>
                  <span className="team-name">{t.name || 'Unknown'}</span>
                  <span className="team-loc">{[t.city, t.state_prov, t.country].filter(Boolean).join(', ')}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="events-section">
        <div className="section-header">
          <h2>{year} Events</h2>
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {loading && <div className="loading">Loading events...</div>}

        {!loading && events.length > 0 && (
          <div className="events-toolbar card">
            <div className="events-toolbar-row">
              <label className="events-field events-field-grow">
                <span className="events-field-label">Find event</span>
                <input
                  type="search"
                  className="input events-search-input"
                  placeholder="Name, key, city, state, country…"
                  value={eventQuery}
                  onChange={(e) => setEventQuery(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="events-field">
                <span className="events-field-label">Week</span>
                <select className="select events-select" value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)}>
                  {weekOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="events-field">
                <span className="events-field-label">Region</span>
                <select className="select events-select" value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
                  {regionOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="events-toolbar-row events-toolbar-row--secondary">
              <div className="events-view-toggle" role="group" aria-label="Layout">
                <button
                  type="button"
                  className={`events-view-btn ${viewMode === 'cards' ? 'active' : ''}`}
                  onClick={() => setViewMode('cards')}
                >
                  Cards
                </button>
                <button
                  type="button"
                  className={`events-view-btn ${viewMode === 'table' ? 'active' : ''}`}
                  onClick={() => setViewMode('table')}
                >
                  Table
                </button>
              </div>
              {viewMode === 'cards' && sortedWeekLabels.length > 0 && (
                <div className="events-expand-actions">
                  <button type="button" className="btn btn-secondary events-toolbar-btn" onClick={expandAllWeeks}>
                    Expand all weeks
                  </button>
                  <button type="button" className="btn btn-secondary events-toolbar-btn" onClick={collapseAllWeeks}>
                    Collapse all
                  </button>
                </div>
              )}
              <span className="events-count">
                Showing <strong>{totalShown}</strong>
                {totalShown !== totalAll ? ` of ${totalAll}` : ''} events
              </span>
            </div>
          </div>
        )}

        {!loading && viewMode === 'table' && filteredEvents.length > 0 && (
          <div className="card events-table-card">
            <div className="ds-table-wrap events-table-wrap">
              <table className="events-table ds-data-table ds-zebra">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Event</th>
                    <th>Location</th>
                    <th>Week</th>
                    <th className="col-key">Key</th>
                  </tr>
                </thead>
                <tbody>
                  {[...filteredEvents]
                    .sort((a, b) => {
                      const da = a.start_date ? new Date(a.start_date).getTime() : 0;
                      const db = b.start_date ? new Date(b.start_date).getTime() : 0;
                      return da - db || (a.name || '').localeCompare(b.name || '');
                    })
                    .map((ev) => (
                      <tr key={ev.key}>
                        <td className="events-td-date">
                          {ev.start_date ? new Date(ev.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'}
                        </td>
                        <td>
                          <Link to={`/event/${ev.key}`} className="events-table-name">
                            {ev.name || ev.key}
                          </Link>
                        </td>
                        <td className="events-td-loc">{[ev.city, ev.state_prov, ev.country].filter(Boolean).join(', ') || '—'}</td>
                        <td>{ev.week != null ? ev.week : '—'}</td>
                        <td className="col-key events-td-key">
                          <code>{ev.key}</code>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && viewMode === 'cards' &&
          sortedWeekLabels.map((week) => {
            const list = grouped[week] || [];
            const isOpen = openWeeks.has(week);
            return (
              <div key={week} className={`week-block ${isOpen ? 'week-block--open' : ''}`}>
                <button
                  type="button"
                  className="week-block-header"
                  onClick={() => toggleWeek(week)}
                  aria-expanded={isOpen}
                >
                  <span className="week-block-chevron" aria-hidden>
                    {isOpen ? '▼' : '▶'}
                  </span>
                  <span className="week-block-title">{week}</span>
                  <span className="week-block-count">{list.length} event{list.length === 1 ? '' : 's'}</span>
                </button>
                {isOpen && (
                  <div className="events-grid">
                    {list.map((ev) => (
                      <Link key={ev.key} to={`/event/${ev.key}`} className="event-card card">
                        <div className="event-name">{ev.name}</div>
                        <div className="event-location">{[ev.city, ev.state_prov, ev.country].filter(Boolean).join(', ')}</div>
                        {ev.start_date && (
                          <div className="event-date">{new Date(ev.start_date).toLocaleDateString()}</div>
                        )}
                        <div className="event-key-hint">
                          <code>{ev.key}</code>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        {!loading && viewMode === 'table' && filteredEvents.length === 0 && events.length > 0 && (
          <div className="card events-empty-filter">
            <p>No events match your filters. Try clearing search or choosing &quot;All weeks&quot; / &quot;All regions&quot;.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => { setEventQuery(''); setWeekFilter('all'); setRegionFilter('all'); }}
            >
              Reset filters
            </button>
          </div>
        )}

        {!loading && viewMode === 'cards' && filteredEvents.length === 0 && events.length > 0 && (
          <div className="card events-empty-filter">
            <p>No events match your filters. Try clearing search or choosing &quot;All weeks&quot; / &quot;All regions&quot;.</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setEventQuery('');
                setWeekFilter('all');
                setRegionFilter('all');
              }}
            >
              Reset filters
            </button>
          </div>
        )}

        {!loading && events.length === 0 && !error && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Not available</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default HomePage;
