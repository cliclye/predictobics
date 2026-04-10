import React, { useMemo } from 'react';
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
import './TeamSeasonCharts.css';

function shortEventLabel(name, eventKey) {
  const raw = (name && String(name).trim()) || eventKey || 'Event';
  return raw.length > 24 ? `${raw.slice(0, 22)}…` : raw;
}

function buildRows(metrics, eventInfos) {
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

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="team-chart-tooltip">
      <div className="team-chart-tooltip-title">{row?.fullLabel || label}</div>
      {row?.matchesPlayed != null && (
        <div className="team-chart-tooltip-meta">Qual matches in model: {row.matches_played}</div>
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
 */
export default function TeamSeasonCharts({ metrics, eventInfos, seasonYear }) {
  const data = useMemo(() => buildRows(metrics || [], eventInfos || {}), [metrics, eventInfos]);

  const flags = useMemo(
    () => ({
      total: seriesHasData(data, 'epaTotal'),
      defense: seriesHasData(data, 'epaDefenseAdj'),
      auto: seriesHasData(data, 'epaAuto'),
      teleop: seriesHasData(data, 'epaTeleop'),
      endgame: seriesHasData(data, 'epaEndgame'),
      cr: seriesHasData(data, 'consistency') || seriesHasData(data, 'reliability'),
      sos: seriesHasData(data, 'sos'),
    }),
    [data],
  );

  const anyEpa = flags.total || flags.defense || flags.auto || flags.teleop || flags.endgame;

  if (!metrics?.length || !anyEpa) {
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

  return (
    <section className="team-season-charts card" aria-label={`EPA season trends for ${seasonYear}`}>
      <div className="team-season-charts-header">
        <h2 className="team-season-charts-title">Season trends</h2>
        <p className="team-season-charts-sub">
          EPA and model stats after each event in {seasonYear} order (left → right). Defense-adjusted EPA blends
          offensive EPA with defensive signal from the regression.
        </p>
      </div>

      <div className="team-chart-block">
        <h3 className="team-chart-block-title">Total &amp; defense-adjusted EPA</h3>
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
                angle={data.length > 6 ? -32 : 0}
                textAnchor={data.length > 6 ? 'end' : 'middle'}
                height={data.length > 6 ? 72 : 36}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                width={44}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ paddingTop: 12 }} formatter={(v) => <span className="team-chart-legend-text">{v}</span>} />
              {flags.total && (
                <Line
                  type="monotone"
                  dataKey="epaTotal"
                  name="Total EPA"
                  stroke="#38bdf8"
                  strokeWidth={2.5}
                  dot={{ r: 3, strokeWidth: 0, fill: '#38bdf8' }}
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
        </div>
      </div>

      {(flags.auto || flags.teleop || flags.endgame) && (
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
                  angle={data.length > 6 ? -32 : 0}
                  textAnchor={data.length > 6 ? 'end' : 'middle'}
                  height={data.length > 6 ? 72 : 36}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  width={44}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 12 }} formatter={(v) => <span className="team-chart-legend-text">{v}</span>} />
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

      {(flags.cr || flags.sos) && (
        <div className="team-chart-block">
          <h3 className="team-chart-block-title">Consistency, reliability &amp; strength of schedule</h3>
          <p className="team-chart-block-hint">Consistency and reliability are 0–1 model weights; SoS is relative event difficulty where available.</p>
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
                  angle={data.length > 6 ? -32 : 0}
                  textAnchor={data.length > 6 ? 'end' : 'middle'}
                  height={data.length > 6 ? 72 : 36}
                />
                <YAxis
                  tick={{ fill: '#94a3b8', fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                  width={44}
                  domain={[0, 'auto']}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ paddingTop: 12 }} formatter={(v) => <span className="team-chart-legend-text">{v}</span>} />
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
