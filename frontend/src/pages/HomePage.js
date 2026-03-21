import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import './HomePage.css';

function HomePage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [teamSearch, setTeamSearch] = useState('');
  const [teamResults, setTeamResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadEvents();
  }, [year]);

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

  async function handleTeamSearch(e) {
    e.preventDefault();
    if (!teamSearch.trim()) return;
    setSearching(true);
    try {
      const key = teamSearch.match(/^\d+$/) ? `frc${teamSearch}` : teamSearch;
      if (key.startsWith('frc')) {
        navigate(`/team/${key}`);
        return;
      }
      const results = await api.searchTeams(teamSearch);
      setTeamResults(results);
    } catch {
      setTeamResults([]);
    }
    setSearching(false);
  }

  async function handleIngest() {
    setIngesting(true);
    setIngestMsg(null);
    try {
      await api.ingest(year);
      setIngestMsg(`Ingesting ${year} data from TBA. This takes a few minutes — refresh shortly.`);
      setTimeout(() => loadEvents(), 60000);
    } catch (err) {
      setIngestMsg(`Ingestion failed: ${err.message}`);
    }
    setIngesting(false);
  }

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2002; y--) years.push(y);

  const grouped = {};
  events.forEach(e => {
    const week = e.week !== null && e.week !== undefined ? `Week ${e.week}` : 'Other';
    if (!grouped[week]) grouped[week] = [];
    grouped[week].push(e);
  });

  return (
    <div className="home-page">
      <div className="hero-section">
        <h1 className="page-title">Predictobics</h1>
        <p className="page-subtitle">Advanced FRC analytics with component EPA, defense-adjusted metrics, and ML-powered predictions</p>

        <form className="search-bar" onSubmit={handleTeamSearch}>
          <input
            className="input search-input"
            placeholder="Search team number or name..."
            value={teamSearch}
            onChange={e => setTeamSearch(e.target.value)}
          />
          <button className="btn btn-primary" type="submit" disabled={searching}>
            {searching ? 'Searching...' : 'Search'}
          </button>
        </form>

        {teamResults.length > 0 && (
          <div className="card team-results">
            {teamResults.map(t => (
              <Link key={t.key} to={`/team/${t.key}`} className="team-result-row">
                <span className="team-number">{t.team_number}</span>
                <span className="team-name">{t.name || 'Unknown'}</span>
                <span className="team-loc">{[t.city, t.state_prov, t.country].filter(Boolean).join(', ')}</span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="events-section">
        <div className="section-header">
          <h2>Events</h2>
          <select className="select" value={year} onChange={e => setYear(Number(e.target.value))}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {error && <div className="error-msg">{error}</div>}
        {loading && <div className="loading">Loading events...</div>}

        {!loading && Object.keys(grouped).sort().map(week => (
          <div key={week} className="week-group">
            <h3 className="week-label">{week}</h3>
            <div className="events-grid">
              {grouped[week].map(ev => (
                <Link key={ev.key} to={`/event/${ev.key}`} className="event-card card">
                  <div className="event-name">{ev.name}</div>
                  <div className="event-location">
                    {[ev.city, ev.state_prov, ev.country].filter(Boolean).join(', ')}
                  </div>
                  {ev.start_date && (
                    <div className="event-date">
                      {new Date(ev.start_date).toLocaleDateString()}
                    </div>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}

        {!loading && events.length === 0 && !error && (
          <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>No event data for {year}.</p>
            {ingestMsg ? (
              <p style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>{ingestMsg}</p>
            ) : (
              <button
                className="btn btn-primary"
                onClick={handleIngest}
                disabled={ingesting}
                style={{ marginTop: '0.5rem' }}
              >
                {ingesting ? 'Starting...' : `Ingest ${year} Data from TBA`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default HomePage;
