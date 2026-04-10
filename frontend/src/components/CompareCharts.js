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
import './CompareCharts.css';

function finiteOrNull(v) {
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

/**
 * Union of both teams' events, sorted by TBA start_date when available.
 */
export function buildCompareTimeline(metricsA, infosA, metricsB, infosB) {
  const mapA = Object.fromEntries((metricsA || []).map((m) => [m.event_key, m]));
  const mapB = Object.fromEntries((metricsB || []).map((m) => [m.event_key, m]));
  const infos = { ...(infosA || {}), ...(infosB || {}) };
  const allKeys = new Set([...Object.keys(mapA), ...Object.keys(mapB)]);
  const rows = [...allKeys].map((ek) => {
    const info = infos[ek] || {};
    const ma = mapA[ek];
    const mb = mapB[ek];
    const start = info.start_date ? new Date(info.start_date).getTime() : null;
    const name = (info.name && String(info.name).trim()) || ek;
    const label = name.length > 20 ? `${name.slice(0, 18)}…` : name;
    return {
      eventKey: ek,
      sortTime: start != null && !Number.isNaN(start) ? start : null,
      label,
      fullLabel: name,
      epaA: finiteOrNull(ma?.epa_total),
      epaB: finiteOrNull(mb?.epa_total),
      defA: finiteOrNull(ma?.epa_defense_adjusted),
      defB: finiteOrNull(mb?.epa_defense_adjusted),
      autoA: finiteOrNull(ma?.epa_auto),
      autoB: finiteOrNull(mb?.epa_auto),
      teleA: finiteOrNull(ma?.epa_teleop),
      teleB: finiteOrNull(mb?.epa_teleop),
      endA: finiteOrNull(ma?.epa_endgame),
      endB: finiteOrNull(mb?.epa_endgame),
      consA: finiteOrNull(ma?.consistency),
      consB: finiteOrNull(mb?.consistency),
      relA: finiteOrNull(ma?.reliability),
      relB: finiteOrNull(mb?.reliability),
      sosA: finiteOrNull(ma?.strength_of_schedule),
      sosB: finiteOrNull(mb?.strength_of_schedule),
      mpA: ma?.matches_played ?? 0,
      mpB: mb?.matches_played ?? 0,
    };
  });
  rows.sort((a, b) => {
    if (a.sortTime != null && b.sortTime != null) return a.sortTime - b.sortTime;
    if (a.sortTime != null) return -1;
    if (b.sortTime != null) return 1;
    return a.eventKey.localeCompare(b.eventKey);
  });
  return rows;
}

function CompareTooltip({ active, payload, labelA, labelB }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="compare-chart-tooltip">
      <div className="compare-chart-tooltip-title">{row?.fullLabel}</div>
      <div className="compare-chart-tooltip-meta">
        {(row?.mpA || 0) > 0 || (row?.mpB || 0) > 0 ? (
          <span>
            Quals in model — {labelA}: {row?.mpA ?? 0} · {labelB}: {row?.mpB ?? 0}
          </span>
        ) : (
          <span>Schedule / carry-forward snapshot</span>
        )}
      </div>
      <ul className="compare-chart-tooltip-rows">
        {payload
          .filter((p) => p.value != null && Number.isFinite(p.value))
          .map((p) => (
            <li key={p.dataKey}>
              <span className="compare-chart-tooltip-dot" style={{ background: p.color }} />
              <span className="compare-chart-tooltip-name">{p.name}</span>
              <span className="compare-chart-tooltip-val">{Number(p.value).toFixed(2)}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}

export default function CompareCharts({ timeline, labelA, labelB, colorA, colorB }) {
  const flags = useMemo(
    () => ({
      epa: timeline.some((r) => r.epaA != null || r.epaB != null),
      def: timeline.some((r) => r.defA != null || r.defB != null),
      comp: timeline.some((r) => r.autoA != null || r.autoB != null),
      cr: timeline.some((r) => r.consA != null || r.consB != null || r.relA != null || r.relB != null),
      sos: timeline.some((r) => r.sosA != null || r.sosB != null),
    }),
    [timeline],
  );

  if (!timeline.length || !flags.epa) {
    return (
      <section className="compare-charts card">
        <h2 className="compare-charts-title">Trajectory overlay</h2>
        <p className="compare-charts-empty">No overlapping EPA timeline for this season — ingest and compute events for both teams.</p>
      </section>
    );
  }

  const xInterval = timeline.length <= 8 ? 0 : Math.ceil(timeline.length / 5) - 1;
  const xProps = {
    type: 'category',
    dataKey: 'label',
    angle: timeline.length > 6 ? -30 : 0,
    textAnchor: timeline.length > 6 ? 'end' : 'middle',
    height: timeline.length > 6 ? 72 : 36,
    interval: xInterval,
  };

  const legendFmt = (v) => <span className="compare-legend-text">{v}</span>;

  const block = (title, hint, children) => (
    <div className="compare-chart-block">
      <h3 className="compare-chart-block-title">{title}</h3>
      {hint && <p className="compare-chart-block-hint">{hint}</p>}
      <div className="compare-chart-surface">{children}</div>
    </div>
  );

  return (
    <section className="compare-charts card" aria-label="Head-to-head EPA trajectories">
      <header className="compare-charts-header">
        <h2 className="compare-charts-title">Trajectory overlay</h2>
        <p className="compare-charts-sub">
          Events merged and ordered chronologically (TBA start dates when available). Each point is the stored EPA snapshot
          after that event’s compute — overlay raw offensive estimate against defense-adjusted regression output.
        </p>
      </header>

      {block(
        'Total EPA',
        'Raw regression contribution (WLS); sum across an alliance approximates expected alliance output before variance layers.',
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
            <XAxis
              {...xProps}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
            />
            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              width={48}
            />
            <Tooltip content={<CompareTooltip labelA={labelA} labelB={labelB} />} />
            <Legend wrapperStyle={{ paddingTop: 12 }} formatter={legendFmt} />
            <Line
              type="monotone"
              dataKey="epaA"
              name={`${labelA} total`}
              stroke={colorA}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: colorA }}
              connectNulls
            />
            <Line
              type="monotone"
              dataKey="epaB"
              name={`${labelB} total`}
              stroke={colorB}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 0, fill: colorB }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>,
      )}

      {flags.def &&
        block(
          'Defense-adjusted EPA',
          'Offensive EPA blended with opponent-strength and defensive-impact terms from the EPA regression.',
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
              <XAxis
                {...xProps}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                width={48}
              />
              <Tooltip content={<CompareTooltip labelA={labelA} labelB={labelB} />} />
              <Legend wrapperStyle={{ paddingTop: 12 }} formatter={legendFmt} />
              <Line
                type="monotone"
                dataKey="defA"
                name={`${labelA} def-adj`}
                stroke={colorA}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={{ r: 2.5, strokeWidth: 0 }}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="defB"
                name={`${labelB} def-adj`}
                stroke={colorB}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={{ r: 2.5, strokeWidth: 0 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>,
        )}

      {flags.comp &&
        block(
          'Component EPA (auto · teleop · endgame)',
          'Decomposition from the same WLS fit — reveals where each robot earns its marginal points.',
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
              <XAxis
                {...xProps}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                width={48}
              />
              <Tooltip content={<CompareTooltip labelA={labelA} labelB={labelB} />} />
              <Legend wrapperStyle={{ paddingTop: 12 }} formatter={legendFmt} />
              <Line type="monotone" dataKey="autoA" name={`${labelA} auto`} stroke="#fb923c" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="autoB" name={`${labelB} auto`} stroke="#fdba74" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="teleA" name={`${labelA} teleop`} stroke="#34d399" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="teleB" name={`${labelB} teleop`} stroke="#6ee7b7" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="endA" name={`${labelA} endgame`} stroke="#fbbf24" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
              <Line type="monotone" dataKey="endB" name={`${labelB} endgame`} stroke="#fde047" strokeWidth={1.8} dot={{ r: 2 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>,
        )}

      {(flags.cr || flags.sos) &&
        block(
          'Model weights & schedule',
          'Consistency / reliability shape Gaussian variance in match predictions; strength of schedule contextualizes EPA level.',
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={timeline} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
              <XAxis
                {...xProps}
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
              />
              <YAxis
                tick={{ fill: '#94a3b8', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: 'rgba(148, 163, 184, 0.2)' }}
                width={48}
                domain={[0, 'auto']}
              />
              <Tooltip content={<CompareTooltip labelA={labelA} labelB={labelB} />} />
              <Legend wrapperStyle={{ paddingTop: 12 }} formatter={legendFmt} />
              {timeline.some((r) => r.consA != null || r.consB != null) && (
                <>
                  <Line type="monotone" dataKey="consA" name={`${labelA} consistency`} stroke="#94a3b8" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line type="monotone" dataKey="consB" name={`${labelB} consistency`} stroke="#cbd5e1" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </>
              )}
              {timeline.some((r) => r.relA != null || r.relB != null) && (
                <>
                  <Line type="monotone" dataKey="relA" name={`${labelA} reliability`} stroke="#64748b" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line type="monotone" dataKey="relB" name={`${labelB} reliability`} stroke="#475569" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </>
              )}
              {flags.sos && (
                <>
                  <Line type="monotone" dataKey="sosA" name={`${labelA} SoS`} stroke="#22d3ee" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                  <Line type="monotone" dataKey="sosB" name={`${labelB} SoS`} stroke="#67e8f9" strokeWidth={2} dot={{ r: 2 }} connectNulls />
                </>
              )}
            </LineChart>
          </ResponsiveContainer>,
        )}
    </section>
  );
}
