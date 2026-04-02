const BASE = '/admin';

export async function fetchRuns(params?: Record<string, string>) {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  const res = await fetch(`${BASE}/runs${qs}`);
  return res.json();
}

export async function fetchRun(id: string) {
  const res = await fetch(`${BASE}/runs/${id}`);
  return res.json();
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/stats`);
  return res.json();
}

export async function fetchSops() {
  const res = await fetch(`${BASE}/sops`);
  return res.json();
}
