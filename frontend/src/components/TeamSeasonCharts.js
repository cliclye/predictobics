import React, { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { buildPerMatchChartRows } from '../utils/chartTimelineUtils';
import './TeamSeasonCharts.css';

function shortEventLabel(name, eventKey) {
  const raw = (name && String(name).trim()) || eventKey || 'Event';
  return raw.length > 24 ? `${raw.slice(0, 22)}…` : raw;
}

function buildEventRows(metrics, eventInfos) {
  return metrics.map((m, i) => {
    const info = eventInfos[m.event_key];
    const name = info?.name || m.event_key;
    return {
      order: i + 1,
      label: shortEventLabel(name, m.event_key),
      fullLabel: name,
      eventKey: m.event_key,
      epaTotal: m.epa_total != null && Number.isFinite(m.epa_total) ? m.epa_total : null,
      epaDefenseAdj:
        m.epa_defense_adjusted != null && Number.isFinite(m.epa_defense_adjusted)
          ? m.epa_defense_adjusted
          : null,
      epaAuto: m.epa_auto != null && Number.isFinite(m.epa_auto) ? m.epa_auto : null,
      epaTeleop: m.epa_teleop != null && Number.isFinite(m.epa_teleop) ? m.epa_teleop : null,
      epaEndgame: m.epa_endgame != null && Number.isFinite(m.epa_endgame) ? m.epa_endgame : null,
      consistency: m.consistency != null && Number.isFinite(m.consistency) ? m.consistency : null,
      reliability: m.reliability != null && Number.isFinite(m.reliability) ? m.reliability : null,
      sos:
        m.strength_of_schedule != null && Number.isFinite(m.strength_of_schedule)
          ? m.strength_of_schedule
          : null,
      matchesPlayed: m.matches_played || 0,
    };
  });
}

function seriesHasData(rows, key) {
  return rows.some((r) => r[key] != null);
}

function ChartTooltip({ active, payload, label, advanced }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="team-chart-tooltip">
      <div className="team-chart-tooltip-title">{row?.fullLabel || label}</div>
      {advanced ? (
        <div className="team-chart-tooltip-meta">
          Total EPA snapshot used for this match&apos;s prediction (updates as the model ingests more quals).
        </div>
      ) : (
        row?.matchesPlayed != null && (
          <div className="team-chart-tooltip-meta">Qual matches in model: {row.matchesPlayed}</div>
        )
      )}
      <ul className="team-chart-tooltip-rows">
        {payload
          .filter((p) => p.value != null && Number.isFinite(p.value))
          .map((p) => (
            <li key={p.dataKey}>
              <span className="team-chart-tooltip-dot" style={{ background: p.color }} />
              <span className="team-chart-tooltip-name">{p.name}</span>
              <span className="team-chart-tooltip-val">
                {typeof p.value === 'number' ? p.value.toFixed(2) : p.value}
              </span>
            </li>
          ))}
      </ul>
    </div>
  );
}

/**
 * Season-over-event EPA & quality charts (data from /team/{key}/season metrics, event order = season timeline).
 * Advanced mode: one point per played match using per-match total EPA from prediction payloads.
 */
export default function TeamSeasonCharts({ metrics, eventInfos, seasonYear, teamKey, eventMatches }) {
  const [chartMode, setChartMode] = useState('basic');

  const eventData = useMemo(() => buildEventRows(metrics || [], eventInfos || {}), [metrics, eventInfos]);
  const matchData = useMemo(
    () => buildPerMatchChartRows(teamKey, metrics, eventMatches, eventInfos),
    [teamKey, metrics, eventMatches, eventInfos],
  );

  const advanced = chartMode === 'advanced';
  const data = advanced ? matchData : eventData;

  const flags = useMemo(
    () => ({
      total: seriesHasData(data, 'epaTotal'),
      defense: !advanced && seriesHasData(data, 'epaDefenseAdj'),
      auto: !advanced && seriesHasData(data, 'epaAuto'),
      teleop: !advanced && seriesHasData(data, 'epaTeleop'),
      endgame: !advanced && seriesHasData(data, 'epaEndgame'),
      cr:
        !advanced &&
        (seriesHasData(data, 'consistency') || seriesHasData(data, 'reliability')),
      sos: !advanced && seriesHasData(data, 'sos'),
    }),
    [data, advanced],
  );

  const anyEpaEvent = useMemo(() => {
    const rows = buildEventRows(metrics || [], eventInfos || {});
    return (
      seriesHasData(rows, 'epaTotal') ||
      seriesHasData(rows, 'epaDefenseAdj') ||
      seriesHasData(rows, 'epaAuto') ||
      seriesHasData(rows, 'epaTeleop') ||
      seriesHasData(rows, 'epaEndgame')
    );
  }, [metrics, eventInfos]);

  if (!metrics?.length || !anyEpaEvent) {
    return (
      <section className="team-season-charts card">
        <h2 className="team-season-charts-title">Season trends</h2>
        <p className="team-season-charts-empty">
          EPA trend charts appear after this team has computed metrics for at least one event this season (run ingest
          / compute from the API).
        </p>
      </section>
    );
  }

  const xInterval = data.length <= 10 ? 0 : Math.ceil(data.length / 6) - 1;
  const tiltX = data.length > 6;
  const tooltipEl = <ChartTooltip advanced={advanced} />;

  return (
    <section className="team-season-charts card" aria-label={`EPA season trends for ${seasonYear}`}>
      <div className="team-season-charts-header">
        <h2 className="team-season-charts-title">Season trends</h2>
        <p className="team-season-charts-sub">
          {advanced ? (
            <>
              One point per <strong>played</strong> match (quals and elims), using total EPA from the model snapshot for
              that match&apos;s prediction. Defense-adjusted, component, and schedule curves stay in Basic (they are stored
              per event, not per match).
            </>
          ) : (
            <>
              EPA and model stats after each event in {seasonYear} order (left → right). Defense-adjusted EPA blends
              offensive EPA with defensive signal from the regression.
            </>
          )}
        </p>
        <div className="team-chart-mode-row" role="group" aria-label="Chart granularity">
          <span className="team-chart-mode-label">View</span>
          <div className="team-chart-mode-btns">
            <button
              type="button"
              className={`team-chart-mode-btn ${!advanced ? 'active' : ''}`}
              onClick={() => setChartMode('basic')}
            >
              Basic
            </button>
            <button
              type="button"
              className={`team-chart-mode-btn ${advanced ? 'active' : ''}`}
              onClick={() => setChartMode('advanced')}
            >
              Advanced
            </button>
          </div>
        </div>
      </div>

      {advanced && matchData.length === 0 && (
        <p className="team-chart-advanced-empty">
          No per-match EPA points found on finished matches (needs prediction fields on match rows). Use Basic for
          event-level charts.
        </p>
      )}

      <div className="team-chart-block">
        <h3 className="team-chart-block-title">Total EPA{advanced ? ' (per match)' : ''}</h3>
        <div className="team-chart-surface">
          {advanced && matchData.length === 0 ? (
            <p className="team-chart-surface-empty">No match-level series to plot.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  interval={xInterval}
                  angle={tiltX ? -32 : 0}
                  textAnchor={tiltX ? 'end' : 'middle'}
                  height={tiltX ? 72 : 36}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  width={44}
                />
                <Tooltip content={tooltipEl} />
                <Legend
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(v) => <span className="team-chart-legend-text">{v}</span>}
                />
                {flags.total && (
                  <Line
                    type="monotone"
                    dataKey="epaTotal"
                    name="Total EPA"
                    stroke="#38bdf8"
                    strokeWidth={2.5}
                    dot={{ r: advanced ? 3.5 : 3, strokeWidth: 0, fill: '#38bdf8' }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                )}
                {flags.defense && (
                  <Line
                    type="monotone"
                    dataKey="epaDefenseAdj"
                    name="Defense-adj. EPA"
                    stroke="#a78bfa"
                    strokeWidth={2}
                    dot={{ r: 3, strokeWidth: 0, fill: '#a78bfa' }}
                    activeDot={{ r: 5 }}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {!advanced && (flags.auto || flags.teleop || flags.endgame) && (
        <div className="team-chart-block">
          <h3 className="team-chart-block-title">Component EPA (auto · teleop · endgame)</h3>
          <div className="team-chart-surface">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  interval={xInterval}
                  angle={tiltX ? -32 : 0}
                  textAnchor={tiltX ? 'end' : 'middle'}
                  height={tiltX ? 72 : 36}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  width={44}
                />
                <Tooltip content={tooltipEl} />
                <Legend
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(v) => <span className="team-chart-legend-text">{v}</span>}
                />
                {flags.auto && (
                  <Line
                    type="monotone"
                    dataKey="epaAuto"
                    name="Auto"
                    stroke="#fb923c"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
                {flags.teleop && (
                  <Line
                    type="monotone"
                    dataKey="epaTeleop"
                    name="Teleop"
                    stroke="#34d399"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
                {flags.endgame && (
                  <Line
                    type="monotone"
                    dataKey="epaEndgame"
                    name="Endgame"
                    stroke="#fbbf24"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {!advanced && (flags.cr || flags.sos) && (
        <div className="team-chart-block">
          <h3 className="team-chart-block-title">Consistency, reliability &amp; strength of schedule</h3>
          <p className="team-chart-block-hint">
            Consistency and reliability are 0–1 model weights; SoS is relative event difficulty where available.
          </p>
          <div className="team-chart-surface">
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  interval={xInterval}
                  angle={tiltX ? -32 : 0}
                  textAnchor={tiltX ? 'end' : 'middle'}
                  height={tiltX ? 72 : 36}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  width={44}
                  domain={[0, 'auto']}
                />
                <Tooltip content={tooltipEl} />
                <Legend
                  wrapperStyle={{ paddingTop: 12 }}
                  formatter={(v) => <span className="team-chart-legend-text">{v}</span>}
                />
                {flags.cr && seriesHasData(data, 'consistency') && (
                  <Line
                    type="monotone"
                    dataKey="consistency"
                    name="Consistency"
                    stroke="#94a3b8"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
                {flags.cr && seriesHasData(data, 'reliability') && (
                  <Line
                    type="monotone"
                    dataKey="reliability"
                    name="Reliability"
                    stroke="#64748b"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
                {flags.sos && (
                  <Line
                    type="monotone"
                    dataKey="sos"
                    name="Strength of schedule"
                    stroke="#22d3ee"
                    strokeWidth={2}
                    dot={{ r: 2.5, strokeWidth: 0 }}
                    connectNulls
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
