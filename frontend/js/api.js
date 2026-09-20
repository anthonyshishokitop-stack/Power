/**
 * API client for City of Tshwane Outage Management
 * Talks to the real Express + SQLite backend
 */

const API = (() => {
  const BASE = window.location.origin; // same origin when served by backend
  let token = localStorage.getItem('tshwane_token') || null;
  let user = JSON.parse(localStorage.getItem('tshwane_user') || 'null');

  function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  async function request(method, path, body) {
    const opts = { method, headers: headers() };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(BASE + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || res.statusText || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    getToken: () => token,
    getUser: () => user,
    isLoggedIn: () => !!token,

    async login(email, password) {
      const data = await request('POST', '/api/auth/login', { email, password });
      token = data.token;
      user = data.user;
      localStorage.setItem('tshwane_token', token);
      localStorage.setItem('tshwane_user', JSON.stringify(user));
      return data;
    },

    logout() {
      token = null;
      user = null;
      localStorage.removeItem('tshwane_token');
      localStorage.removeItem('tshwane_user');
    },

    me: () => request('GET', '/api/auth/me'),

    getOutages: (params = {}) => {
      const q = new URLSearchParams(params).toString();
      return request('GET', '/api/outages' + (q ? '?' + q : ''));
    },

    getOutage: (id) => request('GET', `/api/outages/${id}`),

    createOutage: (payload) => request('POST', '/api/outages', payload),

    assign: (id, techId, notes) =>
      request('POST', `/api/outages/${id}/assign`, { techId, notes }),

    smartAssign: (id) => request('POST', `/api/outages/${id}/smart-assign`),

    updateStatus: (id, status, note, workPerformed) =>
      request('PATCH', `/api/outages/${id}/status`, { status, note, workPerformed }),

    updateMyLocation: (lat, lng) =>
      request('PATCH', '/api/technicians/me/location', { lat, lng }),

    getTechnicians: () => request('GET', '/api/technicians'),

    getAnalytics: () => request('GET', '/api/analytics/summary'),

    health: () => request('GET', '/api/health')
  };
})();
