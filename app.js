/**
 * City of Tshwane – Operational Outage Management Frontend
 * Real-time SPA talking to production API + Socket.io
 */

const App = (() => {
  let socket = null;
  let maps = {};
  let currentView = 'login';

  function toast(msg, type = 'info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${type}`;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 4000);
  }

  function requireAuth(roles = []) {
    if (!API.isLoggedIn()) {
      navigate('login');
      return false;
    }
    const user = API.getUser();
    if (roles.length && !roles.includes(user.role) && user.role !== 'admin') {
      toast('Access denied for your role', 'error');
      navigate('dashboard');
      return false;
    }
    return true;
  }

  function renderNav() {
    const nav = document.getElementById('mainNav');
    const userArea = document.getElementById('userArea');
    if (!API.isLoggedIn()) {
      nav.innerHTML = '';
      userArea.innerHTML = '';
      return;
    }
    const u = API.getUser();
    const links = [
      { view: 'dashboard', label: 'Dashboard', roles: ['dispatcher', 'admin', 'technician'] },
      { view: 'report', label: 'Report Outage', roles: ['dispatcher', 'admin', 'customer'] },
      { view: 'dispatcher', label: 'Dispatcher', roles: ['dispatcher', 'admin'] },
      { view: 'technician', label: 'My Jobs', roles: ['technician', 'admin'] },
      { view: 'analytics', label: 'Analytics', roles: ['dispatcher', 'admin'] }
    ];
    nav.innerHTML = links
      .filter(l => l.roles.includes(u.role) || u.role === 'admin')
      .map(l => `<a href="#${l.view}" class="nav-link ${currentView === l.view ? 'active' : ''}" data-view="${l.view}">${l.label}</a>`)
      .join('');

    userArea.innerHTML = `
      <span class="user-name">${u.fullName} <small>(${u.role})</small></span>
      <button class="btn btn-sm btn-ghost" id="btnLogout">Logout</button>
    `;
    document.getElementById('btnLogout').onclick = () => {
      API.logout();
      if (socket) socket.disconnect();
      navigate('login');
    };
  }

  // ---------- Views ----------
  async function viewLogin() {
    document.getElementById('mainContent').innerHTML = `
      <section class="login-card card">
        <h2>Sign in</h2>
        <p class="muted">Operational access for dispatchers, technicians and administrators.</p>
        <form id="loginForm" class="form">
          <div class="form-group">
            <label>Email</label>
            <input type="email" id="email" required placeholder="dispatcher@tshwane.gov.za" value="dispatcher@tshwane.gov.za">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" id="password" required value="Dispatch@123">
          </div>
          <button type="submit" class="btn btn-primary btn-block">Sign in</button>
        </form>
        <div class="login-hints">
          <p><strong>Demo credentials</strong></p>
          <ul>
            <li>Dispatcher: dispatcher@tshwane.gov.za / Dispatch@123</li>
            <li>Admin: admin@tshwane.gov.za / Admin@123</li>
            <li>Technician: thabo.molefe@tshwane.gov.za / Tech@123</li>
          </ul>
        </div>
      </section>
    `;
    document.getElementById('loginForm').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await API.login(
          document.getElementById('email').value,
          document.getElementById('password').value
        );
        connectSocket();
        toast('Signed in successfully', 'success');
        navigate('dashboard');
      } catch (err) {
        toast(err.message || 'Login failed', 'error');
      }
    };
  }

  async function viewDashboard() {
    if (!requireAuth(['dispatcher', 'admin', 'technician'])) return;
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <section class="page-header">
        <h2>Operations Dashboard</h2>
        <p class="muted">Live overview of the outage network</p>
      </section>
      <section class="stats-grid" id="dashStats">
        <div class="stat-card"><div class="stat-value" id="sOpen">—</div><div class="stat-label">Open</div></div>
        <div class="stat-card"><div class="stat-value" id="sCritical">—</div><div class="stat-label">Critical</div></div>
        <div class="stat-card"><div class="stat-value" id="sAssigned">—</div><div class="stat-label">Assigned</div></div>
        <div class="stat-card"><div class="stat-value" id="sResolved">—</div><div class="stat-label">Resolved</div></div>
      </section>
      <section class="grid-2">
        <div class="card">
          <h3>Live Map</h3>
          <div id="dashMap" class="map"></div>
        </div>
        <div class="card">
          <h3>Recent Outages</h3>
          <div id="recentList" class="list"></div>
        </div>
      </section>
    `;

    try {
      const outages = await API.getOutages();
      const open = outages.filter(o => !['Resolved', 'Closed'].includes(o.status));
      const critical = open.filter(o => o.severity === 'Critical');
      const assigned = open.filter(o => o.assigned_tech_id);
      const resolved = outages.filter(o => ['Resolved', 'Closed'].includes(o.status));

      document.getElementById('sOpen').textContent = open.length;
      document.getElementById('sCritical').textContent = critical.length;
      document.getElementById('sAssigned').textContent = assigned.length;
      document.getElementById('sResolved').textContent = resolved.length;

      document.getElementById('recentList').innerHTML = outages.slice(0, 10).map(renderOutageItem).join('') ||
        '<p class="muted">No outages yet.</p>';

      initMap('dashMap', open);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function viewReport() {
    if (!requireAuth(['dispatcher', 'admin', 'customer'])) return;
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <section class="card form-card">
        <h2>Report Service Outage</h2>
        <p class="muted">Captures account, location, type, severity. System detects duplicates and calculates priority.</p>
        <form id="reportForm" class="form">
          <div class="form-row">
            <div class="form-group">
              <label>Account Number *</label>
              <input name="accountNumber" required placeholder="TSH-12345678">
            </div>
            <div class="form-group">
              <label>Contact Name *</label>
              <input name="contactName" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Contact Phone *</label>
              <input name="contactPhone" required placeholder="+27 ...">
            </div>
            <div class="form-group">
              <label>Email</label>
              <input name="contactEmail" type="email">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Type *</label>
              <select name="type" required>
                <option value="">Select</option>
                <option>No Power</option>
                <option>Partial Outage</option>
                <option>Voltage Fluctuation</option>
                <option>Street Light Failure</option>
                <option>Transformer Issue</option>
                <option>Cable Fault</option>
                <option>Other</option>
              </select>
            </div>
            <div class="form-group">
              <label>Severity *</label>
              <select name="severity" required>
                <option value="">Select</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Estimated Affected Customers</label>
            <input name="affectedCustomers" type="number" min="1" value="1">
          </div>
          <div class="form-group">
            <label>Address *</label>
            <input name="address" required placeholder="Street, suburb, Tshwane">
          </div>
          <div class="form-group">
            <label>Pin location (click map)</label>
            <div id="reportMap" class="map small"></div>
            <input type="hidden" name="lat" id="rLat">
            <input type="hidden" name="lng" id="rLng">
          </div>
          <div class="form-group">
            <label>Description</label>
            <textarea name="description" rows="3"></textarea>
          </div>
          <button type="submit" class="btn btn-primary">Submit Report</button>
        </form>
        <div id="reportResult" class="result hidden"></div>
      </section>
    `;

    const map = L.map('reportMap').setView([-25.7479, 28.2293], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map);
    maps.report = map;
    let marker = null;
    map.on('click', (e) => {
      document.getElementById('rLat').value = e.latlng.lat.toFixed(6);
      document.getElementById('rLng').value = e.latlng.lng.toFixed(6);
      if (marker) map.removeLayer(marker);
      marker = L.marker(e.latlng).addTo(map);
    });

    document.getElementById('reportForm').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      payload.affectedCustomers = parseInt(payload.affectedCustomers, 10) || 1;
      payload.lat = parseFloat(payload.lat) || -25.7479;
      payload.lng = parseFloat(payload.lng) || 28.2293;

      try {
        const res = await API.createOutage(payload);
        const box = document.getElementById('reportResult');
        box.className = 'result success';
        box.innerHTML = `
          <strong>Outage created: ${res.outage.id}</strong><br>
          Priority score: ${res.outage.priority_score.toFixed(0)} · Status: ${res.outage.status}
          ${res.duplicateWarning ? `<br><em>⚠ ${res.duplicateWarning.message}</em>` : ''}
        `;
        box.classList.remove('hidden');
        e.target.reset();
        toast('Outage reported', 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    };
  }

  async function viewDispatcher() {
    if (!requireAuth(['dispatcher', 'admin'])) return;
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <section class="page-header">
        <h2>Dispatcher Console</h2>
        <p class="muted">Prioritise, assign and monitor field crews in real time</p>
      </section>
      <section class="stats-grid small" id="dispStats"></section>
      <section class="grid-2">
        <div class="card">
          <div class="card-head">
            <h3>Prioritised Queue</h3>
            <button class="btn btn-sm btn-primary" id="btnAutoAssign">Smart Assign All</button>
          </div>
          <div id="queue" class="list"></div>
        </div>
        <div class="card">
          <h3>Technicians</h3>
          <div id="techList" class="list"></div>
        </div>
      </section>
      <section class="card">
        <h3>Operations Map</h3>
        <div id="dispMap" class="map"></div>
      </section>
      <div id="assignModal" class="modal hidden">
        <div class="modal-box">
          <h3>Assign Technician</h3>
          <p id="assignInfo"></p>
          <div class="form-group">
            <label>Technician</label>
            <select id="assignTech"></select>
          </div>
          <div class="form-group">
            <label>Notes</label>
            <textarea id="assignNotes" rows="2"></textarea>
          </div>
          <div class="actions">
            <button class="btn btn-primary" id="btnConfirmAssign">Confirm</button>
            <button class="btn btn-ghost" id="btnCancelAssign">Cancel</button>
          </div>
        </div>
      </div>
    `;

    let currentAssignId = null;

    async function refresh() {
      const [outages, techs] = await Promise.all([API.getOutages(), API.getTechnicians()]);
      const open = outages.filter(o => !['Resolved', 'Closed'].includes(o.status));
      const pending = open.filter(o => !o.assigned_tech_id);
      const avail = techs.filter(t => t.status === 'available');

      document.getElementById('dispStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${open.length}</div><div class="stat-label">Open</div></div>
        <div class="stat-card"><div class="stat-value">${pending.length}</div><div class="stat-label">Unassigned</div></div>
        <div class="stat-card"><div class="stat-value">${open.filter(o => o.assigned_tech_id).length}</div><div class="stat-label">In progress</div></div>
        <div class="stat-card"><div class="stat-value">${avail.length}</div><div class="stat-label">Available techs</div></div>
      `;

      const queue = open.sort((a, b) => b.priority_score - a.priority_score);
      document.getElementById('queue').innerHTML = queue.map(o => {
        const actions = o.assigned_tech_id
          ? `<button class="btn btn-sm btn-ghost" data-hist="${o.id}">History</button>`
          : `<button class="btn btn-sm btn-primary" data-assign="${o.id}">Assign</button>
             <button class="btn btn-sm btn-success" data-smart="${o.id}">Smart</button>`;
        return renderOutageItem(o, actions);
      }).join('') || '<p class="muted">Queue empty</p>';

      document.getElementById('techList').innerHTML = techs.map(t => `
        <div class="list-item">
          <div>
            <strong>${t.full_name}</strong> (${t.employee_code})
            <div class="meta">${t.status} · load ${t.workload}/${t.max_jobs}</div>
          </div>
          <span class="dot ${t.status}"></span>
        </div>
      `).join('');

      initMap('dispMap', open, techs);

      // Bind buttons
      document.querySelectorAll('[data-assign]').forEach(btn => {
        btn.onclick = () => openAssign(btn.dataset.assign, outages, techs);
      });
      document.querySelectorAll('[data-smart]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await API.smartAssign(btn.dataset.smart);
            toast('Smart assigned', 'success');
            refresh();
          } catch (e) { toast(e.message, 'error'); }
        };
      });
      document.querySelectorAll('[data-hist]').forEach(btn => {
        btn.onclick = async () => {
          const detail = await API.getOutage(btn.dataset.hist);
          const lines = (detail.history || []).map(h => `${h.created_at} – ${h.status}: ${h.note || ''}`).join('\n');
          alert(`History ${detail.id}\n\n${lines}`);
        };
      });
    }

    function openAssign(id, outages, techs) {
      currentAssignId = id;
      const o = outages.find(x => x.id === id);
      document.getElementById('assignInfo').textContent = `${o.id} · ${o.type} · ${o.address}`;
      const candidates = techs.filter(t => t.status !== 'offduty' && t.workload < t.max_jobs);
      document.getElementById('assignTech').innerHTML = candidates.map(t => {
        const dist = haversine(t.lat, t.lng, o.lat, o.lng).toFixed(1);
        return `<option value="${t.id}">${t.full_name} (${t.status}, ~${dist} km)</option>`;
      }).join('');
      document.getElementById('assignModal').classList.remove('hidden');
    }

    document.getElementById('btnConfirmAssign').onclick = async () => {
      try {
        await API.assign(currentAssignId, document.getElementById('assignTech').value, document.getElementById('assignNotes').value);
        document.getElementById('assignModal').classList.add('hidden');
        toast('Assigned', 'success');
        refresh();
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('btnCancelAssign').onclick = () => {
      document.getElementById('assignModal').classList.add('hidden');
    };
    document.getElementById('btnAutoAssign').onclick = async () => {
      const pending = (await API.getOutages()).filter(o => !o.assigned_tech_id && !['Resolved','Closed'].includes(o.status));
      let n = 0;
      for (const o of pending) {
        try { await API.smartAssign(o.id); n++; } catch {}
      }
      toast(`Smart-assigned ${n} job(s)`, 'success');
      refresh();
    };

    await refresh();
  }

  async function viewTechnician() {
    if (!requireAuth(['technician', 'admin'])) return;
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <section class="page-header">
        <h2>My Assigned Jobs</h2>
        <p class="muted">Update status and share live location</p>
      </section>
      <section class="grid-2">
        <div class="card">
          <h3>Active Jobs</h3>
          <div id="myJobs" class="list"></div>
        </div>
        <div class="card">
          <h3>Map &amp; Tracking</h3>
          <div id="techMap" class="map"></div>
          <div class="actions" style="margin-top:0.75rem">
            <button class="btn btn-sm btn-primary" id="btnShareLoc">Share Current Location</button>
            <button class="btn btn-sm btn-ghost" id="btnSimMove">Simulate Move Toward Job</button>
          </div>
        </div>
      </section>
      <div id="statusModal" class="modal hidden">
        <div class="modal-box">
          <h3>Update Status</h3>
          <p id="statusInfo"></p>
          <div class="form-group">
            <label>New Status</label>
            <select id="newStatus">
              <option>En Route</option>
              <option>Nearby</option>
              <option>On Site</option>
              <option>In Progress</option>
              <option>Resolved</option>
              <option>Delayed</option>
            </select>
          </div>
          <div class="form-group">
            <label>Notes / Work performed</label>
            <textarea id="statusNote" rows="3"></textarea>
          </div>
          <div class="actions">
            <button class="btn btn-primary" id="btnSaveStatus">Save</button>
            <button class="btn btn-ghost" id="btnCancelStatus">Cancel</button>
          </div>
        </div>
      </div>
    `;

    let currentStatusId = null;
    let myJobs = [];

    async function refresh() {
      myJobs = await API.getOutages();
      document.getElementById('myJobs').innerHTML = myJobs.length
        ? myJobs.map(o => renderOutageItem(o, `<button class="btn btn-sm btn-primary" data-status="${o.id}">Update Status</button>`)).join('')
        : '<p class="muted">No active jobs assigned to you.</p>';

      document.querySelectorAll('[data-status]').forEach(btn => {
        btn.onclick = () => {
          currentStatusId = btn.dataset.status;
          const o = myJobs.find(x => x.id === currentStatusId);
          document.getElementById('statusInfo').textContent = `${o.id} · current: ${o.status}`;
          document.getElementById('statusModal').classList.remove('hidden');
        };
      });

      const techs = await API.getTechnicians();
      const me = techs.find(t => t.id === API.getUser().techId);
      initMap('techMap', myJobs, me ? [me] : []);
    }

    document.getElementById('btnSaveStatus').onclick = async () => {
      try {
        await API.updateStatus(
          currentStatusId,
          document.getElementById('newStatus').value,
          document.getElementById('statusNote').value
        );
        document.getElementById('statusModal').classList.add('hidden');
        toast('Status updated – customer notified', 'success');
        refresh();
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('btnCancelStatus').onclick = () => {
      document.getElementById('statusModal').classList.add('hidden');
    };

    document.getElementById('btnShareLoc').onclick = () => {
      if (!navigator.geolocation) return toast('Geolocation not supported', 'error');
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          await API.updateMyLocation(pos.coords.latitude, pos.coords.longitude);
          toast('Location shared', 'success');
          refresh();
        } catch (e) { toast(e.message, 'error'); }
      }, () => toast('Unable to get location', 'error'));
    };

    document.getElementById('btnSimMove').onclick = async () => {
      if (!myJobs.length) return toast('No jobs', 'error');
      const job = myJobs[0];
      const techs = await API.getTechnicians();
      const me = techs.find(t => t.id === API.getUser().techId);
      if (!me) return;
      const lat = (me.lat + job.lat) / 2;
      const lng = (me.lng + job.lng) / 2;
      await API.updateMyLocation(lat, lng);
      if (job.status === 'Assigned') {
        await API.updateStatus(job.id, 'En Route', 'Departed depot (simulated)');
      }
      toast('Location updated toward job', 'success');
      refresh();
    };

    await refresh();
  }

  async function viewAnalytics() {
    if (!requireAuth(['dispatcher', 'admin'])) return;
    const main = document.getElementById('mainContent');
    main.innerHTML = `
      <section class="page-header">
        <h2>Analytics &amp; Insights</h2>
      </section>
      <section class="stats-grid" id="anStats"></section>
      <section class="grid-2">
        <div class="card"><h3>By Status</h3><canvas id="cStatus" height="200"></canvas></div>
        <div class="card"><h3>By Severity</h3><canvas id="cSev" height="200"></canvas></div>
      </section>
      <section class="card"><h3>By Type</h3><canvas id="cType" height="200"></canvas></section>
    `;

    try {
      const s = await API.getAnalytics();
      document.getElementById('anStats').innerHTML = `
        <div class="stat-card"><div class="stat-value">${s.total}</div><div class="stat-label">Total</div></div>
        <div class="stat-card"><div class="stat-value">${s.avgResponseMinutes ?? '—'}</div><div class="stat-label">Avg response (min)</div></div>
        <div class="stat-card"><div class="stat-value">${s.avgResolutionMinutes ?? '—'}</div><div class="stat-label">Avg resolution (min)</div></div>
        <div class="stat-card"><div class="stat-value">${s.resolutionRate}%</div><div class="stat-label">Resolution rate</div></div>
      `;

      drawChart('cStatus', 'doughnut', s.byStatus.map(x => x.status), s.byStatus.map(x => x.count));
      drawChart('cSev', 'doughnut', s.bySeverity.map(x => x.severity), s.bySeverity.map(x => x.count));
      drawChart('cType', 'bar', s.byType.map(x => x.type), s.byType.map(x => x.count));
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ---------- Helpers ----------
  function renderOutageItem(o, actions = '') {
    return `
      <div class="list-item severity-${(o.severity || '').toLowerCase()}">
        <div>
          <strong>${o.id}</strong> · ${o.type}
          <div class="meta">${o.address} · ${o.severity} · ${o.status}
            ${o.tech_name ? ` · Tech: ${o.tech_name}` : ''}
            · Priority ${Math.round(o.priority_score || 0)}
          </div>
        </div>
        <div class="item-actions">${actions}</div>
      </div>
    `;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function initMap(id, outages, techs = []) {
    const el = document.getElementById(id);
    if (!el) return;
    if (maps[id]) { maps[id].remove(); }
    const map = L.map(id).setView([-25.7479, 28.2293], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map);
    maps[id] = map;
    const bounds = [];
    (outages || []).forEach(o => {
      if (o.lat == null) return;
      const color = { Critical: '#c1121f', High: '#e76f51', Medium: '#e9c46a', Low: '#2a9d8f' }[o.severity] || '#0b3d91';
      L.circleMarker([o.lat, o.lng], { radius: 8, color: '#333', weight: 1, fillColor: color, fillOpacity: 0.9 })
        .addTo(map).bindPopup(`<b>${o.id}</b><br>${o.type}<br>${o.status}`);
      bounds.push([o.lat, o.lng]);
    });
    (techs || []).forEach(t => {
      L.marker([t.lat, t.lng]).addTo(map).bindPopup(`<b>${t.full_name || t.employee_code}</b><br>${t.status}`);
      bounds.push([t.lat, t.lng]);
    });
    if (bounds.length) map.fitBounds(bounds, { padding: [40, 40] });
  }

  function drawChart(id, type, labels, data) {
    const ctx = document.getElementById(id);
    if (!ctx) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type,
      data: { labels, datasets: [{ data, backgroundColor: ['#0b3d91', '#2a9d8f', '#e9c46a', '#e76f51', '#c1121f', '#5c6b7a'] }] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: type === 'bar' ? { y: { beginAtZero: true } } : undefined }
    });
  }

  function connectSocket() {
    if (socket) socket.disconnect();
    socket = io({ auth: { token: API.getToken() } });
    socket.on('outage:updated', () => {
      if (['dashboard', 'dispatcher', 'technician'].includes(currentView)) {
        // soft refresh current view
        navigate(currentView, true);
      }
    });
    socket.on('tech:location', () => {
      if (currentView === 'dispatcher' || currentView === 'technician') navigate(currentView, true);
    });
  }

  // ---------- Router ----------
  const views = {
    login: viewLogin,
    dashboard: viewDashboard,
    report: viewReport,
    dispatcher: viewDispatcher,
    technician: viewTechnician,
    analytics: viewAnalytics
  };

  function navigate(view, soft = false) {
    currentView = view;
    if (!soft) window.location.hash = view;
    renderNav();
    const fn = views[view] || views.login;
    fn();
  }

  function init() {
    window.addEventListener('hashchange', () => {
      const v = location.hash.slice(1) || (API.isLoggedIn() ? 'dashboard' : 'login');
      navigate(v);
    });
    if (API.isLoggedIn()) {
      connectSocket();
      navigate(location.hash.slice(1) || 'dashboard');
    } else {
      navigate('login');
    }
  }

  return { init, navigate, toast };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
