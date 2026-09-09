const API_BASE = '/api';

export async function fetchClones() {
  const res = await fetch(`${API_BASE}/clones`);
  if (!res.ok) throw new Error('Failed to fetch clones');
  return res.json();
}

export async function startClone(url, options) {
  const res = await fetch(`${API_BASE}/clones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, options })
  });
  if (!res.ok) throw new Error('Failed to start clone');
  return res.json();
}

export async function deleteClone(id) {
  const res = await fetch(`${API_BASE}/clones/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete clone');
  return res.json();
}

export async function getCloneDetails(id) {
  const res = await fetch(`${API_BASE}/clones/${id}`);
  if (!res.ok) throw new Error('Failed to fetch clone details');
  return res.json();
}
