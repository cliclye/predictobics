import React, { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';
import './PredictPage.css';

function TeamAutocompleteInput({ value, onChange, placeholder }) {
  const [suggestions, setSuggestions] = useState([]);
  const [showDrop, setShowDrop] = useState(false);
  const [hlIdx, setHlIdx] = useState(-1);
  const debounceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    function handleOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowDrop(false);
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const handleChange = useCallback((val) => {
    onChange(val);
    setHlIdx(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const t = val.trim();
    if (!t) { setSuggestions([]); setShowDrop(false); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await api.searchTeams(t);
        setSuggestions(res);
        setShowDrop(res.length > 0);
      } catch { setSuggestions([]); setShowDrop(false); }
    }, 200);
  }, [onChange]);

  function selectTeam(num) {
    onChange(String(num));
    setShowDrop(false);
    setSuggestions([]);
  }

  function handleKeyDown(e) {
    if (!showDrop || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHlIdx(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHlIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hlIdx >= 0) { e.preventDefault(); selectTeam(suggestions[hlIdx].team_number); }
    else if (e.key === 'Escape') setShowDrop(false);
  }

  return (
    <div className="team-ac-wrap" ref={wrapRef}>
      <input
        className="input alliance-input"
        placeholder={placeholder}
        value={value}
        onChange={e => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setShowDrop(true); }}
        onKeyDown={handleKeyDown}
        autoComplete="off"
      />
      {showDrop && suggestions.length > 0 && (
        <div className="team-ac-dropdown">
          {suggestions.map((t, idx) => (
            <button
              key={t.key}
              type="button"
              className={`team-ac-item ${idx === hlIdx ? 'highlighted' : ''}`}
              onMouseDown={() => selectTeam(t.team_number)}
              onMouseEnter={() => setHlIdx(idx)}
            >
              <span className="team-ac-num">{t.team_number}</span>
              <span className="team-ac-name">{t.name || 'Unknown'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PredictPage() {
  const [eventKey, setEventKey] = useState('');
  const [redTeams, setRedTeams] = useState(['', '', '']);
  const [blueTeams, setBlueTeams] = useState(['', '', '']);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function setTeam(color, idx, val) {
    if (color === 'red') {
      const copy = [...redTeams];
      copy[idx] = val;
      setRedTeams(copy);
    } else {
      const copy = [...blueTeams];
      copy[idx] = val;
      setBlueTeams(copy);
    }
  }

  function formatKey(num) {
    const clean = num.trim();
    if (!clean) return '';
    return clean.startsWith('frc') ? clean : `frc${clean}`;
  }

  async function handlePredict(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const red = redTeams.map(formatKey).filter(Boolean);
      const blue = blueTeams.map(formatKey).filter(Boolean);
      if (red.length !== 3 || blue.length !== 3) {
        throw new Error('Enter exactly 3 teams per alliance');
      }
      const res = await api.predictMatch({
        event_key: eventKey.trim(),
        red_teams: red,
        blue_teams: blue,
      });
      setResult(res);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }

  const redWin = result && result.red_win_prob > 0.5;

  return (
    <div className="predict-page ds-page-narrow">
      <h1 className="page-title text-gradient">Match Predictor</h1>
      <p className="page-subtitle">Enter 6 teams to predict the match outcome</p>

      <form className="predict-form" onSubmit={handlePredict}>
        <div className="event-input-row">
          <label className="field-label">Event Key</label>
          <input
            className="input"
            placeholder="e.g. 2025wasno"
            value={eventKey}
            onChange={e => setEventKey(e.target.value)}
          />
        </div>

        <div className="alliances-row">
          <div className="alliance-box red-box">
            <h3>Red Alliance</h3>
            {redTeams.map((t, i) => (
              <TeamAutocompleteInput
                key={`r${i}`}
                value={t}
                onChange={val => setTeam('red', i, val)}
                placeholder={`Team ${i + 1} (e.g. 254)`}
              />
            ))}
          </div>
          <div className="vs-divider">VS</div>
          <div className="alliance-box blue-box">
            <h3>Blue Alliance</h3>
            {blueTeams.map((t, i) => (
              <TeamAutocompleteInput
                key={`b${i}`}
                value={t}
                onChange={val => setTeam('blue', i, val)}
                placeholder={`Team ${i + 1} (e.g. 1678)`}
              />
            ))}
          </div>
        </div>

        <button className="btn btn-primary predict-btn" type="submit" disabled={loading}>
          {loading ? 'Predicting...' : 'Predict Match'}
        </button>
      </form>

      {error && <div className="error-msg">{error}</div>}

      {result && (
        <div className="result-card card">
          <div className="result-header">
            <span className={`result-winner ${redWin ? 'red-winner' : 'blue-winner'}`}>
              {redWin ? 'Red' : 'Blue'} Alliance Favored
            </span>
            <span className="badge badge-blue">{result.model_used}</span>
          </div>

          <div className="prob-bar-container">
            <div className="prob-label red-label">{(result.red_win_prob * 100).toFixed(1)}%</div>
            <div className="prob-bar">
              <div className="prob-red" style={{ width: `${result.red_win_prob * 100}%` }} />
              <div className="prob-blue" style={{ width: `${result.blue_win_prob * 100}%` }} />
            </div>
            <div className="prob-label blue-label">{(result.blue_win_prob * 100).toFixed(1)}%</div>
          </div>

          <div className="grid-2" style={{ marginTop: '1rem' }}>
            <div className="stat-card">
              <div className="stat-label">Red Expected Score</div>
              <div className="stat-value" style={{ color: 'var(--red)' }}>
                {result.red_expected_score.toFixed(1)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Blue Expected Score</div>
              <div className="stat-value" style={{ color: 'var(--accent)' }}>
                {result.blue_expected_score.toFixed(1)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default PredictPage;
