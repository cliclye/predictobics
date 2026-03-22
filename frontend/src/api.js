const BASE = process.env.REACT_APP_API_URL || '/api';

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

async function postJSON(path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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
  ingest: (year) => postJSON(`/ingest/${year}`),
  compute: (eventKey) => postJSON(`/compute/${eventKey}`),
  train: (year) => postJSON(`/train/${year}`),
  getDistrictsForLocks: (year) => fetchJSON(`/district_locks/districts/${year}`),
  getDistrictLocks: (districtKey, year) =>
    fetchJSON(`/district_locks/${encodeURIComponent(districtKey)}/${year}`),
};
