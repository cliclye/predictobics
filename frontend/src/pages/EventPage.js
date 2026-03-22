import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import './EventPage.css';

function EventPage() {
  const { eventKey } = useParams();
  const [event, setEvent] = useState(null);
  const [rankings, setRankings] = useState([]);
  const [prediction, setPrediction] = useState(null);
  const [predError, setPredError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [predLoading, setPredLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortField, setSortField] = useState('epa_total');
  const [sortDir, setSortDir] = useState('desc');
  const [activeTab, setActiveTab] = useState('rankings');

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

  const loadPrediction = useCallback(async () => {
    setPredLoading(true);
    setPredError(null);
    try {
      const pred = await api.getEventPrediction(eventKey);
      setPrediction(pred);
    } catch (err) {
      console.error('Prediction load failed:', err);
      setPrediction(null);
      setPredError(err.message || 'Could not load event predictions.');
    }
    setPredLoading(false);
  }, [eventKey]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadPrediction(); }, [loadPrediction]);

  useEffect(() => {
    const interval = setInterval(() => { loadData(true); loadPrediction(); }, 120000);
    return () => clearInterval(interval);
  }, [loadData, loadPrediction]);

  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
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

  const maxEpa = rankings.length > 0 ? Math.max(...rankings.map(r => r.epa_total || 0)) : 1;

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

      <div className="event-tabs">
        <button className={`event-tab ${activeTab === 'rankings' ? 'active' : ''}`} onClick={() => setActiveTab('rankings')}>EPA Rankings</button>
        <button className={`event-tab ${activeTab === 'predictions' ? 'active' : ''}`} onClick={() => setActiveTab('predictions')}>Event Predictions</button>
      </div>

      {activeTab === 'rankings' && (
        <>
          {chartData.length > 0 && (
            <div className="card" style={{ marginBottom: '1rem' }}>
              <div className="card-header">Top 20 Teams by EPA</div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData} margin={{ bottom: 20 }}>
                  <XAxis dataKey="team" tick={{ fill: '#8b949e', fontSize: 11 }} angle={-45} textAnchor="end" />
                  <YAxis tick={{ fill: '#8b949e', fontSize: 12 }} />
                  <Tooltip contentStyle={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: 8 }} labelStyle={{ color: '#e6edf3' }} />
                  <Bar dataKey="epa" fill="#58a6ff" radius={[4, 4, 0, 0]} />
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
                      <th className="sortable" onClick={() => handleSort('epa_total')}>EPA {sortField === 'epa_total' && (sortDir === 'desc' ? '↓' : '↑')}</th>
                      <th className="sortable" onClick={() => handleSort('epa_auto')}>Auto {sortField === 'epa_auto' && (sortDir === 'desc' ? '↓' : '↑')}</th>
                      <th className="sortable" onClick={() => handleSort('epa_teleop')}>Teleop {sortField === 'epa_teleop' && (sortDir === 'desc' ? '↓' : '↑')}</th>
                      <th className="sortable" onClick={() => handleSort('epa_endgame')}>Endgame {sortField === 'epa_endgame' && (sortDir === 'desc' ? '↓' : '↑')}</th>
                      <th className="sortable" onClick={() => handleSort('consistency')}>Consistency {sortField === 'consistency' && (sortDir === 'desc' ? '↓' : '↑')}</th>
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
              <p style={{ color: 'var(--text-muted)' }}>No rankings data available.</p>
            </div>
          )}
        </>
      )}

      {activeTab === 'predictions' && (
        <div className="predictions-section">
          {predLoading && <div className="loading">Running simulations...</div>}
          {prediction && <EventPredictions pred={prediction} />}
          {predError && (
            <div className="card pred-error-card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: '#f85149', marginBottom: '0.75rem', fontWeight: 600 }}>Predictions unavailable</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 520, margin: '0 auto' }}>{predError}</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '1rem' }}>
                If you host the site on Vercel, set <code style={{ color: 'var(--accent)' }}>REACT_APP_API_URL</code> to your Railway API URL and redeploy.
              </p>
            </div>
          )}
          {!predLoading && !prediction && !predError && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: 'var(--text-muted)' }}>No prediction data available.</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                Ingest the event year from the home page, then run compute so EPA exists for this event.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function EventPredictions({ pred }) {
  const winnerAlliance = pred.predicted_alliances.find(a => a.number === pred.predicted_winner);

  return (
    <div className="pred-container">
      {(pred.ranking_method_note || pred.alliance_selection_note) && (
        <div className="card pred-info-banner">
          {pred.ranking_method_note && <p className="pred-info-line">{pred.ranking_method_note}</p>}
          {pred.alliance_selection_note && (
            <p className="pred-info-line">
              <strong>Alliance selection:</strong> {pred.alliance_selection_note}
              {pred.event_year ? (
                <span className="pred-meta"> ({pred.event_year}
                  {pred.alliance_skip_first_pick ? ', skip-first-pick applied' : ''})
                </span>
              ) : null}
            </p>
          )}
        </div>
      )}
      {/* Predicted Winner */}
      <div className="card pred-winner-card">
        <div className="card-header">Predicted Event Winner</div>
        <div className="winner-display">
          <span className="winner-alliance-num">Alliance {pred.predicted_winner}</span>
          <div className="winner-teams">
            {pred.predicted_winner_teams.map(tk => (
              <Link key={tk} to={`/team/${tk}`} className="winner-team-badge">
                {tk.replace('frc', '')}
              </Link>
            ))}
          </div>
          {winnerAlliance && (
            <span className="winner-epa">Combined EPA: {winnerAlliance.alliance_epa}</span>
          )}
        </div>
      </div>

      {/* Playoff Bracket */}
      <div className="card">
        <div className="card-header">Predicted Playoff Bracket</div>
        <div className="bracket-container">
          {['Quarterfinal', 'Semifinal', 'Final'].map(round => {
            const matches = pred.playoff_bracket.filter(m => m.round_name === round);
            return (
              <div key={round} className="bracket-round">
                <h4 className="round-label">{round}s</h4>
                {matches.map((m, i) => (
                  <div key={i} className="bracket-match">
                    <div className={`bracket-team ${m.winner === m.red_alliance ? 'bracket-winner' : ''}`}>
                      <span className="bracket-seed">A{m.red_alliance}</span>
                      <span className="bracket-pct">{(m.red_win_prob * 100).toFixed(0)}%</span>
                    </div>
                    <div className={`bracket-team ${m.winner === m.blue_alliance ? 'bracket-winner' : ''}`}>
                      <span className="bracket-seed">A{m.blue_alliance}</span>
                      <span className="bracket-pct">{((1 - m.red_win_prob) * 100).toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Predicted Alliances */}
      <div className="card">
        <div className="card-header">Predicted Alliance Selection</div>
        <div className="alliances-grid">
          {pred.predicted_alliances.map(a => (
            <div key={a.number} className={`alliance-card ${a.number === pred.predicted_winner ? 'alliance-winner' : ''}`}>
              <div className="alliance-header">
                <span className="alliance-num">Alliance {a.number}</span>
                <span className="alliance-epa-badge">{a.alliance_epa}</span>
              </div>
              <div className="alliance-teams">
                <Link to={`/team/${a.captain}`} className="alliance-team captain">
                  <span className="role-tag">C</span> {a.captain_num}
                </Link>
                {a.pick1 && (
                  <Link to={`/team/${a.pick1}`} className="alliance-team">
                    <span className="role-tag">P1</span> {a.pick1_num}
                  </Link>
                )}
                {a.pick2 && (
                  <Link to={`/team/${a.pick2}`} className="alliance-team">
                    <span className="role-tag">P2</span> {a.pick2_num}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Predicted Rankings */}
      <div className="card">
        <div className="card-header">Predicted Qual Rankings</div>
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>EPA</th>
                <th>Pred RP</th>
                <th>Qual W-L-T</th>
                <th>Pred Record</th>
                <th>Win %</th>
              </tr>
            </thead>
            <tbody>
              {pred.predicted_rankings.map(r => (
                <tr key={r.team_key}>
                  <td style={{ color: 'var(--text-muted)' }}>{r.rank}</td>
                  <td>
                    <Link to={`/team/${r.team_key}`} className="team-link">
                      <span className="team-num">{r.team_number}</span>
                      {r.team_name && <span className="team-nm">{r.team_name}</span>}
                    </Link>
                  </td>
                  <td style={{ fontWeight: 600 }}>{(r.epa_total || 0).toFixed(1)}</td>
                  <td>{r.predicted_rp.toFixed(1)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                    {r.actual_qual_record || '—'}
                  </td>
                  <td>{r.predicted_record}</td>
                  <td>
                    <span className={`win-pct-cell ${r.win_pct >= 0.6 ? 'high' : r.win_pct >= 0.4 ? 'mid' : 'low'}`}>
                      {(r.win_pct * 100).toFixed(0)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default EventPage;
