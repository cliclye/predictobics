import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import './PnwDcmpPage.css';

/**
 * Resolves PNW District Championship on TBA and sends users to the normal event page
 * (EPA rankings, event predictions, playoff predictions) for that event_key.
 */
export default function PnwDcmpPage() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const years = [];
  for (let y = new Date().getFullYear() + 1; y >= 2002; y--) years.push(y);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const r = await api.getDistrictChampionshipEvent('pnw', year);
        if (cancelled) return;
        navigate(`/event/${r.event_key}`, { replace: true });
      } catch (e) {
        if (cancelled) return;
        setError(e.message || 'Could not look up the PNW District Championship on TBA.');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [year, navigate]);

  return (
    <div className="pnw-dcmp-page ds-page-narrow">
      <div className="pnw-dcmp-hero">
        <h1 className="page-title">PNW District Championship</h1>
        <p className="page-subtitle">
          Opening EPA rankings and predictions for the Pacific Northwest DCMP on TBA. Uses the same event page as any
          regional — ingest and compute that event if data is missing.
        </p>
      </div>

      <div className="card pnw-dcmp-controls">
        <label>
          Season
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={loading}>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="loading pnw-dcmp-loading">Looking up PNW DCMP on The Blue Alliance…</div>
      )}

      {!loading && error && (
        <div className="card pnw-dcmp-error">
          <p className="pnw-dcmp-error-title">Could not open predictions</p>
          <p className="pnw-dcmp-error-msg">{error}</p>
          <p className="pnw-dcmp-hint">
            Try another season, confirm <code>TBA_API_KEY</code> on the API, or open the event from{' '}
            <Link to="/">Events</Link> if you know the event key (often like <code>2026pncmp</code>).
          </p>
        </div>
      )}

    </div>
  );
}
