export async function api(path, { method = 'GET', body, blob = false } = {}) {
  const token = sessionStorage.getItem('adminToken');
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && token) {
    window.dispatchEvent(new CustomEvent('admin-logout', { detail: { message: 'La sesión expiró. Ingresa de nuevo.' } }));
  }
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `Error ${res.status}`);
  }
  if (blob) return res.blob();
  return res.status === 204 ? null : res.json();
}