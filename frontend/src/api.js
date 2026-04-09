/**
 * API base: unset → same-origin `/api`. For Railway etc., set at build time:
 * REACT_APP_API_URL=https://YOUR_SERVICE.up.railway.app/api
 * (must include `/api` — that is where FastAPI mounts routes.)
 */
function normalizeApiBaseFromEnv() {
  const raw = (process.env.REACT_APP_API_URL || '').trim();
  if (!raw) return '/api';
  if (!/^https?:\/\//i.test(raw)) {
    const b = raw.replace(/\/+$/, '');
    if (!b) return '/api';
    return b.startsWith('/') ? b : `/${b}`;
  }
  try {
    const u = new URL(raw.replace(/\/+$/, ''));
    const p = u.pathname.replace(/\/+$/, '') || '/';
    if (p === '/') {
      u.pathname = '/api';
    } else if (p !== '/api' && !p.endsWith('/api')) {
      u.pathname = `${p}/api`;
    } else {
      u.pathname = p;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return /\/api$/i.test(raw) ? raw.replace(/\/+$/, '') : `${raw.replace(/\/+$/, '')}/api`;
  }
}

const BASE = normalizeApiBaseFromEnv();

/** Resolved API root (for debugging). */
export const apiBaseUrl = BASE;

function apiUrl(path) {
  const base = BASE.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

function apiUnreachableHelp(err) {
  const errMsg = err && err.message ? String(err.message) : '';
  const isRelative = !BASE.startsWith('http');
  if (isRelative && process.env.NODE_ENV === 'development') {
    return (
      'Cannot reach the API. Start the backend on port 8000 (from repo root: ' +
      'PYTHONPATH=. ./venv/bin/python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000) ' +
      'or run everything with: cd frontend && npm install && npm run dev'
    );
  }
  if (isRelative) {
    return (
      'Cannot reach the API. On Vercel, set environment variable BACKEND_ORIGIN to your FastAPI origin ' +
      '(HTTPS, no /api suffix), or build with REACT_APP_API_URL pointing at your API. ' +
      'Otherwise serve the app from the same host as FastAPI, or set REACT_APP_API_URL.'
    );
  }
  const healthUrl = `${BASE.replace(/\/+$/, '')}/health`;
  return (
    `Cannot reach the API at ${BASE}. ` +
    `Try opening ${healthUrl} in a new tab (expect {"status":"ok"}). ` +
    `If that fails, Railway may be sleeping, the deploy crashed (check logs / DATABASE_URL), or the URL is wrong. ` +
    `If /health works here but the app still errors, fix CORS on the API: set CORS_ORIGINS=* on Railway, ` +
    'or list your exact frontend origin; for Vercel previews set CORS_ORIGIN_REGEX=https://.*\\.vercel\\.app on the API. ' +
    `(see .env.example). ` +
    (errMsg ? `Browser reported: ${errMsg}` : '')
  );
}

/** Set only for trusted private builds; value is visible in the client bundle. */
const ADMIN_CLIENT_SECRET = (process.env.REACT_APP_ADMIN_API_SECRET || '').trim();

export const clientCanSendWriteSecret = Boolean(ADMIN_CLIENT_SECRET);

async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(apiUrl(path));
  } catch (e) {
    throw new Error(apiUnreachableHelp(e));
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const hint =
      process.env.NODE_ENV === 'development'
        ? ' Expected JSON from /api — is the FastAPI app running on 127.0.0.1:8000?'
        : ' Check REACT_APP_API_URL ends with /api and the Railway service is running.';
    throw new Error(`The server did not return JSON (${contentType || 'unknown type'}).${hint}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!res.ok) {
    const detail = data.detail;
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? detail.map((d) => d.msg).join('; ')
          : `API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function postJSON(path, body, { admin } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (admin && ADMIN_CLIENT_SECRET) {
    headers['X-Admin-Secret'] = ADMIN_CLIENT_SECRET;
  }

  let res;
  try {
    res = await fetch(apiUrl(path), {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error(apiUnreachableHelp(e));
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const hint =
      process.env.NODE_ENV === 'development'
        ? ' Expected JSON from /api — is the FastAPI app running on 127.0.0.1:8000?'
        : ' Check REACT_APP_API_URL ends with /api and the Railway service is running.';
    throw new Error(`The server did not return JSON (${contentType || 'unknown type'}).${hint}`);
  }
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  if (!res.ok) {
    const detail = data.detail;
    const msg =
      typeof detail === 'string'
        ? detail
        : Array.isArray(detail) && detail[0]?.msg
          ? detail.map((d) => d.msg).join('; ')
          : `API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/**
 * Whether the API requires a shared secret for ingest / compute / train / bulk.
 * Older APIs without this route are treated as not requiring a secret.
 */
export async function fetchServerInfo() {
  try {
    return await fetchJSON('/server-info');
  } catch {
    return { write_secret_required: false };
  }
}

export const api = {
  getTeam: (key, year) => fetchJSON(`/team/${key}${year ? `?year=${year}` : ''}`),
  /** Team + season metrics + all event matches + event info in one request. */
  getTeamSeason: (key, year) => fetchJSON(`/team/${key}/season?year=${year}`),
  searchTeams: (query, page = 0) => fetchJSON(`/teams?search=${encodeURIComponent(query)}&page=${page}&size=20`),
  getEvent: (key) => fetchJSON(`/event/${key}`),
  getEvents: (year) => fetchJSON(`/events?year=${year}`),
  getRankings: (eventKey) => fetchJSON(`/rankings/${eventKey}`),
  getMatches: (eventKey) => fetchJSON(`/matches/${eventKey}`),
  predictMatch: (body) => postJSON('/match_prediction', body),
  simulate: (eventKey, n = 280) => fetchJSON(`/simulate/${eventKey}?n=${n}`),
  getEventPrediction: (eventKey, n = 280) =>
    fetchJSON(`/event_prediction/${eventKey}?n=${n}`),
  getPlayoffPrediction: (eventKey) => fetchJSON(`/playoff_prediction/${eventKey}`),
  ingest: (year) => postJSON(`/ingest/${year}`, undefined, { admin: true }),
  compute: (eventKey) => postJSON(`/compute/${eventKey}`, undefined, { admin: true }),
  train: (year) => postJSON(`/train/${year}`, undefined, { admin: true }),
  getDistrictsForLocks: (year) => fetchJSON(`/district_locks/districts/${year}`),
  /** All district-model districts for a season with DCMP + WCMP lock tables (one aggregated API call). */
  getAllDistrictsWcmpLocks: (year, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.nSimulations != null) q.set('n_simulations', String(opts.nSimulations));
    const suffix = q.toString() ? `?${q}` : '';
    return fetchJSON(`/district_locks/wcmp/${year}${suffix}`);
  },
  getDistrictLocks: (districtKey, year, opts = {}) => {
    const q = new URLSearchParams();
    if (opts.dcmpSpots != null) q.set('dcmp_spots', String(opts.dcmpSpots));
    if (opts.wcmpAllocatedSpots != null) q.set('wcmp_allocated_spots', String(opts.wcmpAllocatedSpots));
    if (opts.wcmpMeritSpots != null) q.set('wcmp_merit_spots', String(opts.wcmpMeritSpots));
    const suffix = q.toString() ? `?${q}` : '';
    return fetchJSON(`/district_locks/${encodeURIComponent(districtKey)}/${year}${suffix}`);
  },
  /** TBA District Championship event key (e.g. pnw + year → DCMP for predictions). */
  getDistrictChampionshipEvent: (districtAbbrev, year) =>
    fetchJSON(`/district_locks/championship/${encodeURIComponent(districtAbbrev)}/${year}`),
};
