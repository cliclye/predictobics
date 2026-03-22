import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api';
import './EventPage.css';

/** Display order for 8-alliance double-elimination playoff bracket (API round_name). */
const PLAYOFF_ROUND_ORDER = [
  'Upper Round 1',
  'Lower Round 1',
  'Upper Round 2',
  'Lower Round 2',
  'Upper Bracket Final',
  'Lower Bracket Final',
  'Finals',
];
const LEGACY_PLAYOFF_ROUNDS = ['Quarterfinal', 'Semifinal', 'Final'];

/** Double-elim band groupings (TBA-style winners / losers / finals). */
const DE_WINNERS_ROUNDS = ['Upper Round 1', 'Upper Round 2', 'Upper Bracket Final'];
const DE_LOSERS_ROUNDS = ['Lower Round 1', 'Lower Round 2', 'Lower Bracket Final'];
const DE_FINALS = 'Finals';

/** Real finalized scores only (same rule as TeamPage). */
function matchHasScores(m) {
  if (m.red_score == null || m.blue_score == null) return false;
  if (m.red_score < 0 || m.blue_score < 0) return false;
  return true;
}

function allianceNumForTeams(teamKeys, alliances) {
  const s = new Set((teamKeys || []).filter(Boolean));
  if (s.size === 0) return null;
  for (const al of alliances) {
    const ts = new Set((al.teams || []).filter(Boolean));
    if (ts.size !== s.size) continue;
    let ok = true;
    for (const t of s) {
      if (!ts.has(t)) {
        ok = false;
        break;
      }
    }
    if (ok) return al.number;
  }
  return null;
}

/**
 * Best-of-3 style: walk games in time order between two alliances; reset when one reaches 2 wins.
 * Returns display text, numeric winner if decided, and whether prediction matched.
 */
function actualSeriesForPair(idA, idB, alliances, playoffMatches) {
  if (!alliances || !playoffMatches || playoffMatches.length === 0) {
    return { text: null, winner: null, predCorrect: null };
  }
  const games = playoffMatches
    .filter(matchHasScores)
    .slice()
    .sort((a, b) => {
      const ta = a.time ? new Date(a.time).getTime() : 0;
      const tb = b.time ? new Date(b.time).getTime() : 0;
      return ta - tb;
    });

  let wa = 0;
  let wb = 0;
  let lastCompletedWinner = null;

  for (const pm of games) {
    const rNum = allianceNumForTeams(pm.red_teams, alliances);
    const bNum = allianceNumForTeams(pm.blue_teams, alliances);
    if (rNum == null || bNum == null) continue;
    const pair = new Set([rNum, bNum]);
    if (!pair.has(idA) || !pair.has(idB)) continue;

    let winNum = null;
    if (pm.winning_alliance === 'red') winNum = rNum;
    else if (pm.winning_alliance === 'blue') winNum = bNum;
    else if (pm.red_score > pm.blue_score) winNum = rNum;
    else if (pm.blue_score > pm.red_score) winNum = bNum;
    else continue;

    if (winNum === idA) wa += 1;
    else if (winNum === idB) wb += 1;

    if (wa >= 2 || wb >= 2) {
      lastCompletedWinner = wa >= 2 ? idA : idB;
      wa = 0;
      wb = 0;
    }
  }

  if (wa > 0 || wb > 0) {
    let text = `Series ${wa}–${wb}`;
    if (wa !== wb) {
      const leader = wa > wb ? idA : idB;
      text = `A${leader} leads ${wa}–${wb}`;
    }
    return { text, winner: null, predCorrect: null };
  }
  if (lastCompletedWinner != null) {
    return {
      text: `A${lastCompletedWinner} won`,
      winner: lastCompletedWinner,
      predCorrect: null,
    };
  }
  return { text: null, winner: null, predCorrect: null };
}

function allianceNumsForBracket(a) {
  if (!a) return '';
  if (Array.isArray(a.team_numbers) && a.team_numbers.length) return a.team_numbers.join(', ');
  const nums = [a.captain_num, a.pick1_num, a.pick2_num].filter((n) => n != null && n !== '');
  return nums.join(', ');
}

function DoubleElimBracket({ bracket, alliances, playoffMatches }) {
  const rounds = bracket.some((m) => m.round_name === 'Upper Round 1')
    ? PLAYOFF_ROUND_ORDER
    : LEGACY_PLAYOFF_ROUNDS;
  const isDe = bracket.some((m) => m.round_name === 'Upper Round 1');
  const findA = (n) => (alliances ? alliances.find((x) => x.number === n) : null);
  const showActual = playoffMatches !== undefined && alliances;

  const renderMatch = (m, i, round) => {
    const redA = findA(m.red_alliance);
    const blueA = findA(m.blue_alliance);
    const numsR = allianceNumsForBracket(redA);
    const numsB = allianceNumsForBracket(blueA);
    const extraClass = numsR || numsB ? ' playoff-bracket-match' : '';
    const actual = showActual
      ? actualSeriesForPair(m.red_alliance, m.blue_alliance, alliances, playoffMatches)
      : { text: null, winner: null };
    const predCorrect =
      actual.winner != null ? actual.winner === m.winner : null;
    const predRowClass =
      predCorrect === true ? ' bracket-match--pred-ok' : predCorrect === false ? ' bracket-match--pred-miss' : '';
    return (
      <div key={`${round}-${m.match_num}-${i}`} className={`bracket-match${extraClass}${predRowClass}`}>
        <div className="bracket-match-meta">Match {m.match_num}</div>
        <div className={`bracket-team ${m.winner === m.red_alliance ? 'bracket-winner' : ''} bracket-team--red`}>
          <span className="bracket-seed">A{m.red_alliance}</span>
          {numsR ? <span className="bracket-team-nums">{numsR}</span> : null}
          <span className="bracket-pct">{(m.red_win_prob * 100).toFixed(0)}%</span>
        </div>
        <div className={`bracket-team ${m.winner === m.blue_alliance ? 'bracket-winner' : ''} bracket-team--blue`}>
          <span className="bracket-seed">A{m.blue_alliance}</span>
          {numsB ? <span className="bracket-team-nums">{numsB}</span> : null}
          <span className="bracket-pct">{((1 - m.red_win_prob) * 100).toFixed(0)}%</span>
        </div>
        {showActual && (
          <div className="bracket-match-actual">
            <span className="bracket-actual-label">Actual</span>
            <span
              className={
                predCorrect === true
                  ? 'bracket-actual-val ok'
                  : predCorrect === false
                    ? 'bracket-actual-val miss'
                    : 'bracket-actual-val'
              }
            >
              {actual.text || '—'}
            </span>
          </div>
        )}
      </div>
    );
  };

  const renderRoundColumn = (round) => {
    const matches = bracket
      .filter((mn) => mn.round_name === round)
      .sort((a, b) => a.match_num - b.match_num);
    if (matches.length === 0) return null;
    return (
      <div key={round} className="bracket-round">
        <h4 className="round-label">{round}</h4>
        {matches.map((m, i) => renderMatch(m, i, round))}
      </div>
    );
  };

  if (!isDe) {
    return (
      <div className="bracket-container bracket-container--legacy">
        {rounds.map((round) => renderRoundColumn(round))}
      </div>
    );
  }

  return (
    <div className="bracket-de">
      <div className="bracket-de-band">
        <div className="bracket-de-band-title">Winners bracket</div>
        <div className="bracket-de-scroll">
          {DE_WINNERS_ROUNDS.map((r) => renderRoundColumn(r))}
        </div>
      </div>
      <div className="bracket-de-band bracket-de-band--losers">
        <div className="bracket-de-band-title">Losers bracket</div>
        <div className="bracket-de-scroll">
          {DE_LOSERS_ROUNDS.map((r) => renderRoundColumn(r))}
        </div>
      </div>
      <div className="bracket-de-band bracket-de-band--finals">
        <div className="bracket-de-band-title">Finals</div>
        <div className="bracket-de-scroll bracket-de-scroll--finals">
          {renderRoundColumn(DE_FINALS)}
        </div>
      </div>
    </div>
  );
}

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
  const [playoffPred, setPlayoffPred] = useState(null);
  const [playoffError, setPlayoffError] = useState(null);
  const [playoffLoading, setPlayoffLoading] = useState(false);
  /** Non-qual matches for this event (playoff tab): polled every 2 min for actual results next to predictions. */
  const [playoffMatches, setPlayoffMatches] = useState([]);

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

  const loadPlayoffPrediction = useCallback(async () => {
    setPlayoffLoading(true);
    setPlayoffError(null);
    try {
      const data = await api.getPlayoffPrediction(eventKey);
      setPlayoffPred(data);
    } catch (err) {
      setPlayoffPred(null);
      setPlayoffError(err.message || 'Could not load playoff predictions.');
    }
    setPlayoffLoading(false);
  }, [eventKey]);

  const loadPlayoffMatches = useCallback(async () => {
    try {
      const all = await api.getMatches(eventKey);
      setPlayoffMatches((all || []).filter((m) => m.comp_level !== 'qm'));
    } catch {
      setPlayoffMatches([]);
    }
  }, [eventKey]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { loadPrediction(); }, [loadPrediction]);

  useEffect(() => {
    if (activeTab === 'playoffs' && !playoffPred && !playoffLoading) {
      loadPlayoffPrediction();
    }
  }, [activeTab, playoffPred, playoffLoading, loadPlayoffPrediction]);

  useEffect(() => {
    if (activeTab !== 'playoffs') return undefined;
    loadPlayoffMatches();
    const id = setInterval(loadPlayoffMatches, 120000);
    return () => clearInterval(id);
  }, [activeTab, loadPlayoffMatches]);

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
        <button className={`event-tab ${activeTab === 'playoffs' ? 'active' : ''}`} onClick={() => setActiveTab('playoffs')}>Playoff Predictions</button>
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

      {activeTab === 'playoffs' && (
        <div className="predictions-section">
          {playoffLoading && <div className="loading">Loading playoff predictions...</div>}
          {playoffPred && <PlayoffPredictions data={playoffPred} playoffMatches={playoffMatches} />}
          {playoffError && (
            <div className="card pred-error-card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: '#f85149', marginBottom: '0.75rem', fontWeight: 600 }}>Playoff predictions unavailable</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: 520, margin: '0 auto' }}>{playoffError}</p>
            </div>
          )}
          {!playoffLoading && !playoffPred && !playoffError && (
            <div className="card" style={{ textAlign: 'center', padding: '2rem' }}>
              <p style={{ color: 'var(--text-muted)' }}>No playoff data available.</p>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                Alliance selection may not have happened yet for this event.
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

      {/* Playoff Bracket (double elimination) */}
      <div className="card">
        <div className="card-header">Predicted Playoff Bracket</div>
        <DoubleElimBracket bracket={pred.playoff_bracket} alliances={pred.predicted_alliances} />
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

function PlayoffPredictions({ data, playoffMatches }) {
  const winnerAlliance = data.alliances.find(a => a.number === data.predicted_winner);

  return (
    <div className="pred-container">
      <div className="card pred-info-banner">
        <p className="pred-info-line">
          Playoff predictions use the official <strong>double-elimination</strong> bracket (13 matches + finals),{' '}
          <strong>actual alliance selections</strong> from The Blue Alliance, and best-of-3 win probability from
          offense EPA plus <strong>defense-adjusted EPA</strong> blended into each alliance&apos;s strength.
          The likely champion is the alliance that wins most often in Monte Carlo simulation of the bracket.
        </p>
        <p className="pred-info-line pred-info-line--sub">
          <strong>Actual</strong> results use scores from this event&apos;s playoff matches in the database; they refresh
          automatically every <strong>2 minutes</strong> while this tab is open (same cadence as the rest of the event page).
          Best-of-3 series show live wins (e.g. &quot;A3 leads 1–0&quot;) and the winner when the series finishes.
        </p>
      </div>

      {/* Predicted Winner */}
      <div className="card pred-winner-card">
        <div className="card-header">Predicted Playoff Winner</div>
        <div className="winner-display">
          <span className="winner-alliance-num">Alliance {data.predicted_winner}</span>
          <div className="winner-teams">
            {data.predicted_winner_teams.map(tk => (
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

      {/* Playoff Bracket (double elimination) */}
      <div className="card">
        <div className="card-header">Playoff Bracket</div>
        <DoubleElimBracket bracket={data.playoff_bracket} alliances={data.alliances} playoffMatches={playoffMatches} />
      </div>

      {/* Actual Alliances */}
      <div className="card">
        <div className="card-header">Alliances</div>
        <div className="alliances-grid">
          {data.alliances.filter(a => a.teams.length > 0).map(a => (
            <div key={a.number} className={`alliance-card ${a.number === data.predicted_winner ? 'alliance-winner' : ''}`}>
              <div className="alliance-header">
                <span className="alliance-num">Alliance {a.number}</span>
                <span className="alliance-epa-badge">{a.alliance_epa}</span>
              </div>
              <div className="alliance-teams">
                {a.teams.map((tk, idx) => (
                  <Link key={tk} to={`/team/${tk}`} className={`alliance-team ${idx === 0 ? 'captain' : ''}`}>
                    <span className="role-tag">{idx === 0 ? 'C' : `P${idx}`}</span> {a.team_numbers[idx] || tk.replace('frc', '')}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default EventPage;
