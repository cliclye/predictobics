import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import './EventPage.css';

function EventPage() {
  const { eventKey } = useParams();
  const [event, setEvent] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('epa_total');
  const [sortDir, setSortDir] = useState('desc');

  const loadData = useCallback(async (silent = false) => {
    if (!silent) { setLoading(true); setError(null); }
    try {
      const [ev, ranks] = await Promise.all([
        api.getEvent(eventKey),
        api.getRankings(eventKey).catch(() => []),
      ]);
      setEvent(ev);
      setRankings(ranks);
    } catch (err) {
      if (!silent) setError(err.message);
    }
    if (!silent) setLoading(false);
  }, [eventKey]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const interval = setInterval(() => loadData(true), 120000);
    return () => clearInterval(interval);
  }, [loadData]);

  function handleSort(field) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  const sorted = [...rankings].sort((a, b) => {
    const av = a[sortField] ?? 0;
    const bv = b[sortField] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });

  const chartData = sorted.slice(0, 20).map(r => ({
    team: `${r.team_number}`,
    epa: +(r.epa_total || 0).toFixed(1),
  }));

  const maxEpa = rankings.length > 0
    ? Math.max(...rankings.map(r => r.epa_total || 0))
    : 1;

  if (loading) return <div className="loading">Loading event...</div>;
  if (error) return <div className="error-msg">{error}</div>;

  return (
    <div className="event-page">
      {event && (
        <div className="event-header">
          <h1 className="page-title">{event.name}</h1>
          <p className="page-subtitle">
            {[event.city, event.state_prov, event.country].filter(Boolean).join(', ')}
            {event.start_date && ` · ${new Date(event.start_date).toLocaleDateString()}`}
          </p>
        </div>
      )}

      {chartData.length > 0 && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <div className="card-header">Top 20 Teams by EPA</div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ bottom: 20 }}>
              <XAxis dataKey="team" tick={{ fill: '#94a3b8', fontSize: 11 }} angle={-45} textAnchor="end" />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip
                contentStyle={{ background: '#1a2235', border: '1px solid #2a3a54', borderRadius: 8 }}
                labelStyle={{ color: '#f1f5f9' }}
              />
              <Bar dataKey="epa" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {sorted.length > 0 ? (
        <div className="card">
          <div className="card-header">EPA Rankings</div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Team</th>
                  <th className="sortable" onClick={() => handleSort('epa_total')}>
                    EPA {sortField === 'epa_total' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('epa_auto')}>
                    Auto {sortField === 'epa_auto' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('epa_teleop')}>
                    Teleop {sortField === 'epa_teleop' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('epa_endgame')}>
                    Endgame {sortField === 'epa_endgame' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('epa_defense_adjusted')}>
                    Def. Adj. {sortField === 'epa_defense_adjusted' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th className="sortable" onClick={() => handleSort('consistency')}>
                    Consistency {sortField === 'consistency' && (sortDir === 'desc' ? '↓' : '↑')}
                  </th>
                  <th>Matches</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, idx) => (
                  <tr key={r.team_key}>
                    <td style={{ color: 'var(--text-muted)' }}>{idx + 1}</td>
                    <td>
                      <Link to={`/team/${r.team_key}`} className="team-link">
                        <span className="team-num">{r.team_number}</span>
                        {r.team_name && <span className="team-nm">{r.team_name}</span>}
                      </Link>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span style={{ fontWeight: 600, minWidth: 40 }}>{(r.epa_total || 0).toFixed(1)}</span>
                        <div className="epa-bar" style={{ flex: 1, maxWidth: 80 }}>
                          <div className="epa-bar-fill" style={{ width: `${((r.epa_total || 0) / maxEpa) * 100}%` }} />
                        </div>
                      </div>
                    </td>
                    <td>{(r.epa_auto || 0).toFixed(1)}</td>
                    <td>{(r.epa_teleop || 0).toFixed(1)}</td>
                    <td>{(r.epa_endgame || 0).toFixed(1)}</td>
                    <td>{(r.epa_defense_adjusted || 0).toFixed(1)}</td>
                    <td>{((r.consistency || 0) * 100).toFixed(0)}%</td>
                    <td>{r.matches_played}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
          <p style={{ color: 'var(--text-muted)' }}>No rankings data available. Run metrics computation first.</p>
        </div>
      )}
    </div>
  );
}

export default EventPage;
