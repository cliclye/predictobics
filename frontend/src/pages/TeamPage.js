import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api, fetchServerInfo, clientCanSendWriteSecret } from '../api';
import './TeamPage.css';

const COMP_LABELS = { qm: 'Quals', ef: 'Eighths', qf: 'Quarters', sf: 'Semis', f: 'Finals' };

function TeamPage() {
  const { teamKey } = useParams();
  const [year, setYear] = useState(new Date().getFullYear());
  const [team, setTeam] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [eventMatches, setEventMatches] = useState({});
  const [eventInfos, setEventInfos] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [ingesting, setIngesting] = useState(false);
  const [ingestMsg, setIngestMsg] = useState(null);
  const [serverWriteSecret, setServerWriteSecret] = useState(null);
  const [algoOpen, setAlgoOpen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);

  useEffect(() => {
    fetchServerInfo().then((s) => setServerWriteSecret(!!s.write_secret_required));
  }, []);

  const years = [];
  for (let y = new Date().getFullYear(); y >= 2002; y--) years.push(y);

  const loadTeam = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError(null);
      setEventMatches({});
      setEventInfos({});
    }
    try {
      const result = await api.getTeam(teamKey, year);
      setTeam(result.team);
      setMetrics(result.metrics);

      const eventKeys = result.metrics.map(m => m.event_key);
      const matchPromises = eventKeys.map(ek =>
        api.getMatches(ek).then(matches => [ek, matches]).catch(() => [ek, []])
      );
      const eventPromises = eventKeys.map(ek =>
        api.getEvent(ek).then(ev => [ek, ev]).catch(() => [ek, null])
      );

      const [matchResults, eventResults] = await Promise.all([
        Promise.all(matchPromises),
        Promise.all(eventPromises),
      ]);

      const mMap = {};
      matchResults.forEach(([ek, matches]) => { mMap[ek] = matches; });
      setEventMatches(mMap);

      const eMap = {};
      eventResults.forEach(([ek, ev]) => { if (ev) eMap[ek] = ev; });
      setEventInfos(eMap);
      setLastRefresh(new Date());
    } catch (err) {
      if (!silent) setError(err.message);
    }
    if (!silent) setLoading(false);
  }, [teamKey, year]);

  useEffect(() => { loadTeam(); }, [loadTeam]);

  useEffect(() => {
    const interval = setInterval(() => loadTeam(true), 120000);
    return () => clearInterval(interval);
  }, [loadTeam]);

  if (loading) return <div className="loading">Loading team data...</div>;
  if (error) return <div className="error-msg">{error}</div>;
  if (!team) return null;

  return (
    <div className="team-page">
      <div className="team-top-bar">
        <div className="team-identity">
          <h1 className="team-title">{team.team_number}</h1>
          <span className="team-name-text">{team.name || 'Unknown Team'}</span>
        </div>
        <div className="team-meta-row">
          <span className="team-location">
            {[team.city, team.state_prov, team.country].filter(Boolean).join(', ')}
          </span>
          {team.rookie_year && <span className="team-rookie">Rookie {team.rookie_year}</span>}
        </div>
      </div>

      <div className="year-selector-bar">
        <label className="year-label">Season</label>
        <div className="year-pills">
          {years.slice(0, 8).map(y => (
            <button
              key={y}
              className={`year-pill ${y === year ? 'active' : ''}`}
              onClick={() => setYear(y)}
            >
              {y}
            </button>
          ))}
          <select
            className="year-more-select"
            value={years.indexOf(year) >= 8 ? year : ''}
            onChange={e => e.target.value && setYear(Number(e.target.value))}
          >
            <option value="">More...</option>
            {years.slice(8).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {lastRefresh && (
        <div className="auto-refresh-bar">
          <span className="refresh-dot"></span>
          Live — auto-updates every 2 min
          <span className="refresh-time">Last: {lastRefresh.toLocaleTimeString()}</span>
        </div>
      )}

      {metrics.length > 0 && (
        <div className="algo-info-section">
          <button className="algo-toggle" onClick={() => setAlgoOpen(o => !o)}>
            <span className={`algo-arrow ${algoOpen ? 'open' : ''}`}>&#9654;</span>
            How Predictions Work
          </button>
          {algoOpen && (
            <div className="algo-content">
              <div className="algo-grid">
                <div className="algo-card">
                  <h4>EPA (Expected Points Added)</h4>
                  <p>
                    Each team's contribution to their alliance's score is estimated using
                    weighted least squares regression across all qualification matches.
                    Recent matches are weighted more heavily so EPA reflects current form.
                  </p>
                </div>
                <div className="algo-card">
                  <h4>Predicted Scores</h4>
                  <p>
                    The predicted alliance score is the sum of the three teams' EPAs.
                    This represents the expected (average) score — individual matches will
                    vary above and below this due to natural game variance.
                  </p>
                </div>
                <div className="algo-card">
                  <h4>Win Probability</h4>
                  <p>
                    Each alliance's score is modeled as a Normal distribution using the EPA
                    sum as the mean and per-team variance from match history. The win
                    probability is P(red score {'>'} blue score) computed from the combined
                    distribution. Typical accuracy: 75–83%.
                  </p>
                </div>
                <div className="algo-card">
                  <h4>Actual Result</h4>
                  <p>
                    The "Actual" column shows the real match outcome for your team —
                    W (win), L (loss), or T (tie). Click the expand button on any match
                    row to see the full EPA breakdown and prediction reasoning.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {metrics.length === 0 ? (
        <div className="empty-state">
          <p className="empty-title">No data for {year}</p>
          <p className="empty-sub">This team has no ingested events for the {year} season.</p>
          {ingestMsg ? (
            <p className="ingest-msg">{ingestMsg}</p>
          ) : serverWriteSecret === null ? (
            <p className="ingest-msg" style={{ color: 'var(--text-muted)' }}>
              Loading…
            </p>
          ) : serverWriteSecret && !clientCanSendWriteSecret ? (
            <p className="ingest-msg" style={{ color: 'var(--text-muted)' }}>
              Ingestion from this site is turned off for this server. Use an admin client with X-Admin-Secret or run
              the API without a write secret in development.
            </p>
          ) : (
            <button
              className="btn btn-primary"
              style={{ marginTop: '1rem' }}
              disabled={ingesting}
              onClick={async () => {
                setIngesting(true);
                setIngestMsg(null);
                try {
                  await api.ingest(year);
                  setIngestMsg(`Ingesting ${year} data. This takes a few minutes — refresh shortly.`);
                  setTimeout(() => loadTeam(), 60000);
                } catch (err) {
                  setIngestMsg(`Failed: ${err.message}`);
                }
                setIngesting(false);
              }}
            >
              {ingesting ? 'Starting...' : `Ingest ${year} Data from TBA`}
            </button>
          )}
        </div>
      ) : (
        metrics.map(m => (
          <EventSection
            key={m.event_key}
            metric={m}
            eventInfo={eventInfos[m.event_key]}
            matches={eventMatches[m.event_key] || []}
            teamKey={teamKey}
            allEventMatches={eventMatches[m.event_key] || []}
          />
        ))
      )}
    </div>
  );
}


function EventSection({ metric, eventInfo, matches, teamKey, allEventMatches }) {
  const teamMatches = matches.filter(
    m => m.red_teams.includes(teamKey) || m.blue_teams.includes(teamKey)
  );

  const qualMatches = teamMatches.filter(m => m.comp_level === 'qm');
  const wins = qualMatches.filter(m => {
    if (!m.winning_alliance) return false;
    const isRed = m.red_teams.includes(teamKey);
    return (isRed && m.winning_alliance === 'red') || (!isRed && m.winning_alliance === 'blue');
  }).length;
  const losses = qualMatches.filter(m => {
    if (!m.winning_alliance) return false;
    const isRed = m.red_teams.includes(teamKey);
    return (isRed && m.winning_alliance === 'blue') || (!isRed && m.winning_alliance === 'red');
  }).length;
  const ties = qualMatches.filter(m => m.winning_alliance === '' || (m.red_score !== null && m.red_score === m.blue_score && m.winning_alliance === null)).length;

  return (
    <div className="event-section">
      <div className="event-info-bar">
        <div className="event-info-left">
          <Link to={`/event/${metric.event_key}`} className="event-link-name">
            {eventInfo?.name || metric.event_key}
          </Link>
          <div className="event-sub-info">
            {eventInfo?.week !== null && eventInfo?.week !== undefined && (
              <span className="event-week-badge">Week {eventInfo.week}</span>
            )}
            {metric.matches_played > 0 && (
              <span className="event-record">Record: {wins}-{losses}{ties > 0 ? `-${ties}` : ''}</span>
            )}
          </div>
        </div>
        <div className="epa-pills">
          <span className="epa-pill auto">Auto: {(metric.epa_auto || 0).toFixed(1)}</span>
          <span className="epa-pill teleop">Teleop: {(metric.epa_teleop || 0).toFixed(1)}</span>
          <span className="epa-pill endgame">Endgame: {(metric.epa_endgame || 0).toFixed(1)}</span>
          <span className="epa-pill total">Total: {(metric.epa_total || 0).toFixed(1)}</span>
        </div>
      </div>

      {teamMatches.length > 0 ? (
        <div className="match-table-wrap">
          <table className="match-table">
            <thead>
              <tr>
                <th className="col-match">Match</th>
                <th className="col-alliance" colSpan={3}>Red Alliance</th>
                <th className="col-alliance" colSpan={3}>Blue Alliance</th>
                <th className="col-scores">Scores</th>
                <th className="col-actual">Actual</th>
                <th className="col-preds">Score Preds</th>
                <th className="col-winpred">Win Pred</th>
                <th className="col-explain-hdr"></th>
              </tr>
            </thead>
            <tbody>
              {teamMatches.map(match => (
                <MatchRow key={match.key} match={match} teamKey={teamKey} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="no-matches-msg">No match schedule available</div>
      )}
    </div>
  );
}


function MatchRow({ match, teamKey }) {
  const [expanded, setExpanded] = useState(false);
  const isRed = match.red_teams.includes(teamKey);
  const played = match.red_score !== null && match.blue_score !== null && match.red_score >= 0 && match.blue_score >= 0;
  const label = `${COMP_LABELS[match.comp_level] || match.comp_level} ${match.match_number}`;

  let winProb = null;
  if (match.red_win_prob !== null && match.red_win_prob !== undefined) {
    winProb = isRed ? match.red_win_prob : (1 - match.red_win_prob);
  }

  let actualResult = null;
  if (played && match.winning_alliance) {
    const won = (isRed && match.winning_alliance === 'red') || (!isRed && match.winning_alliance === 'blue');
    const lost = (isRed && match.winning_alliance === 'blue') || (!isRed && match.winning_alliance === 'red');
    if (won) actualResult = 'W';
    else if (lost) actualResult = 'L';
    else actualResult = 'T';
  } else if (played && match.red_score === match.blue_score) {
    actualResult = 'T';
  }

  const timeStr = match.time
    ? new Date(match.time).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : null;

  const redPredPerTeam = match.red_predicted_score !== null ? (match.red_predicted_score / 3) : null;
  const bluePredPerTeam = match.blue_predicted_score !== null ? (match.blue_predicted_score / 3) : null;

  const predCorrect = played && match.winning_alliance && match.red_win_prob !== null
    ? ((match.red_win_prob >= 0.5 && match.winning_alliance === 'red') ||
       (match.red_win_prob < 0.5 && match.winning_alliance === 'blue'))
    : null;

  const colCount = 12;

  return (
    <>
      <tr className={played ? '' : 'unplayed'}>
        <td className="col-match match-label">{label}</td>
        {match.red_teams.map((tk, i) => (
          <td key={`r${i}`} className={`col-team red-cell ${tk === teamKey ? 'highlight-team' : ''}`}>
            <Link to={`/team/${tk}`}>{tk.replace('frc', '')}</Link>
          </td>
        ))}
        {match.blue_teams.map((tk, i) => (
          <td key={`b${i}`} className={`col-team blue-cell ${tk === teamKey ? 'highlight-team' : ''}`}>
            <Link to={`/team/${tk}`}>{tk.replace('frc', '')}</Link>
          </td>
        ))}
        <td className="col-scores">
          {played ? (
            <span>
              <span className="score-red">{match.red_score}</span>
              {' – '}
              <span className="score-blue">{match.blue_score}</span>
            </span>
          ) : (
            <span className="scheduled-time">{timeStr || '—'}</span>
          )}
        </td>
        <td className="col-actual">
          {actualResult === 'W' && <span className="actual-badge actual-win">W</span>}
          {actualResult === 'L' && <span className="actual-badge actual-loss">L</span>}
          {actualResult === 'T' && <span className="actual-badge actual-tie">T</span>}
          {!actualResult && <span className="actual-pending">--</span>}
        </td>
        <td className="col-preds">
          {match.red_predicted_score !== null ? (
            <span>
              <span className="pred-red">{match.red_predicted_score}</span>
              {' – '}
              <span className="pred-blue">{match.blue_predicted_score}</span>
            </span>
          ) : '—'}
        </td>
        <td className="col-winpred">
          {winProb !== null ? (
            <span className={`win-badge ${winProb >= 0.5 ? 'favored' : 'underdog'}`}>
              <span className="win-pct">{(winProb * 100).toFixed(0)}%</span>
            </span>
          ) : '—'}
        </td>
        <td className="col-explain-btn">
          <button
            className={`explain-toggle ${expanded ? 'open' : ''}`}
            onClick={() => setExpanded(e => !e)}
            title="Show prediction breakdown"
          >
            &#9654;
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="explain-row">
          <td colSpan={colCount}>
            <div className="explain-content">
              <div className="explain-section">
                <div className="explain-alliance red-explain">
                  <span className="explain-label">Red Alliance EPA</span>
                  <span className="explain-breakdown">
                    {match.red_teams.map(tk => {
                      const perTeam = redPredPerTeam !== null ? redPredPerTeam.toFixed(1) : '?';
                      return <span key={tk} className="explain-team-epa">{tk.replace('frc', '')}: {perTeam}</span>;
                    })}
                    <span className="explain-total">= {match.red_predicted_score ?? '?'}</span>
                  </span>
                </div>
                <div className="explain-alliance blue-explain">
                  <span className="explain-label">Blue Alliance EPA</span>
                  <span className="explain-breakdown">
                    {match.blue_teams.map(tk => {
                      const perTeam = bluePredPerTeam !== null ? bluePredPerTeam.toFixed(1) : '?';
                      return <span key={tk} className="explain-team-epa">{tk.replace('frc', '')}: {perTeam}</span>;
                    })}
                    <span className="explain-total">= {match.blue_predicted_score ?? '?'}</span>
                  </span>
                </div>
              </div>
              <div className="explain-reasoning">
                {match.red_predicted_score !== null && match.blue_predicted_score !== null && (
                  <>
                    <span className="explain-gap">
                      EPA gap: {match.red_predicted_score > match.blue_predicted_score ? '+' : ''}
                      {(match.red_predicted_score - match.blue_predicted_score).toFixed(1)} (
                      {match.red_predicted_score > match.blue_predicted_score ? 'Red' : 'Blue'} favored)
                    </span>
                    {match.red_win_prob !== null && (
                      <span className="explain-prob">
                        Red win: {(match.red_win_prob * 100).toFixed(1)}% | Blue win: {((1 - match.red_win_prob) * 100).toFixed(1)}%
                      </span>
                    )}
                  </>
                )}
                {predCorrect !== null && (
                  <span className={`explain-verdict ${predCorrect ? 'correct' : 'incorrect'}`}>
                    {predCorrect ? 'Prediction correct' : 'Prediction incorrect'}
                  </span>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default TeamPage;
