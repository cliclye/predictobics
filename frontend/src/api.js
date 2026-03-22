const BASE = process.env.REACT_APP_API_URL || '/api';

/** Set only for trusted private builds; value is visible in the client bundle. */
const ADMIN_CLIENT_SECRET = (process.env.REACT_APP_ADMIN_API_SECRET || '').trim();

export const clientCanSendWriteSecret = Boolean(ADMIN_CLIENT_SECRET);

async function fetchJSON(path) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`);
  } catch (e) {
    throw new Error('Cannot reach the API server. Is the backend running?');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Backend not connected. Deploy the API server and set REACT_APP_API_URL.');
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
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new Error('Cannot reach the API server. Is the backend running?');
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('Backend not connected. Deploy the API server and set REACT_APP_API_URL.');
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
  searchTeams: (query, page = 0) => fetchJSON(`/teams?search=${encodeURIComponent(query)}&page=${page}&size=20`),
  getEvent: (key) => fetchJSON(`/event/${key}`),
  getEvents: (year) => fetchJSON(`/events?year=${year}`),
  getRankings: (eventKey) => fetchJSON(`/rankings/${eventKey}`),
  getMatches: (eventKey) => fetchJSON(`/matches/${eventKey}`),
  predictMatch: (body) => postJSON('/match_prediction', body),
  simulate: (eventKey, n = 500) => fetchJSON(`/simulate/${eventKey}?n=${n}`),
  getEventPrediction: (eventKey) => fetchJSON(`/event_prediction/${eventKey}`),
  getPlayoffPrediction: (eventKey) => fetchJSON(`/playoff_prediction/${eventKey}`),
  ingest: (year) => postJSON(`/ingest/${year}`, undefined, { admin: true }),
  compute: (eventKey) => postJSON(`/compute/${eventKey}`, undefined, { admin: true }),
  train: (year) => postJSON(`/train/${year}`, undefined, { admin: true }),
  getDistrictsForLocks: (year) => fetchJSON(`/district_locks/districts/${year}`),
  getDistrictLocks: (districtKey, year) =>
    fetchJSON(`/district_locks/${encodeURIComponent(districtKey)}/${year}`),
};
