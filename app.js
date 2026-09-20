/**
 * City of Tshwane – Smart Outage Management System
 * Full end-to-end demo: Report → Deduplicate → Prioritise → Dispatch → Assign → Track → Repair → Notify → Close → Analyse
 * Data persisted in localStorage. Ready for GitHub Pages.
 */

const OutageSystem = (() => {
  const STORAGE_KEY = 'tshwane_outages_v1';
  const TECH_KEY = 'tshwane_techs_v1';

  // Default technicians (Pretoria / Tshwane area)
  const DEFAULT_TECHS = [
    { id: 'T01', name: 'Thabo Molefe', status: 'available', lat: -25.7479, lng: 28.2293, workload: 0, phone: '+27 82 100 1001' },
    { id: 'T02', name: 'Lerato Nkosi', status: 'available', lat: -25.7520, lng: 28.1880, workload: 0, phone: '+27 82 100 1002' },
    { id: 'T03', name: 'Johan van der Berg', status: 'available', lat: -25.7310, lng: 28.2180, workload: 0, phone: '+27 82 100 1003' },
    { id: 'T04', name: 'Nomsa Dlamini', status: 'available', lat: -25.7650, lng: 28.2750, workload: 0, phone: '+27 82 100 1004' },
    { id: 'T05', name: 'Pieter Botha', status: 'offduty', lat: -25.7100, lng: 28.2000, workload: 0, phone: '+27 82 100 1005' }
  ];

  let outages = [];
  let technicians = [];
  let maps = {};
  let currentAssignId = null;
  let currentStatusId = null;
  let reportMarker = null;

  // ---------- Persistence ----------
  function load() {
    try {
      const o = localStorage.getItem(STORAGE_KEY);
      outages = o ? JSON.parse(o) : [];
      const t = localStorage.getItem(TECH_KEY);
      technicians = t ? JSON.parse(t) : JSON.parse(JSON.stringify(DEFAULT_TECHS));
    } catch (e) {
      outages = [];
      technicians = JSON.parse(JSON.stringify(DEFAULT_TECHS));
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outages));
    localStorage.setItem(TECH_KEY, JSON.stringify(technicians));
  }

  // ---------- Helpers ----------
  function uid() {
    return 'OUT-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  function now() {
    return new Date().toISOString();
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('en-ZA', { dateStyle: 'short', timeStyle: 'short' });
  }

  function severityScore(s) {
    return { Critical: 100, High: 70, Medium: 40, Low: 15 }[s] || 20;
  }

  function priorityScore(o) {
    const sev = severityScore(o.severity);
    const affected = Math.min((o.affectedCustomers || 1) * 2, 50);
    const ageMin = (Date.now() - new Date(o.reportedAt).getTime()) / 60000;
    const age = Math.min(ageMin / 2, 30);
    return sev + affected + age;
  }

  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function badgeClass(val) {
    const v = (val || '').toLowerCase().replace(/\s/g, '');
    if (['critical', 'high', 'medium', 'low'].includes(v)) return 'badge-' + v;
    if (v.includes('resolved') || v === 'completed') return 'badge-resolved';
    if (v.includes('enroute') || v === 'enroute') return 'badge-enroute';
    if (v.includes('onsite') || v === 'onsite') return 'badge-onsite';
    if (v.includes('delay')) return 'badge-delayed';
    if (v.includes('assign')) return 'badge-assigned';
    return 'badge-open';
  }

  // ---------- Core Business Logic ----------
  function detectDuplicate(newOutage) {
    const thresholdKm = 0.8; // ~800 m
    const open = outages.filter(o => !['Resolved', 'Closed'].includes(o.status));
    for (const o of open) {
      if (!o.lat || !newOutage.lat) continue;
      const dist = haversine(o.lat, o.lng, newOutage.lat, newOutage.lng);
      if (dist <= thresholdKm && o.type === newOutage.type) {
        return { isDuplicate: true, existing: o, distanceKm: dist.toFixed(2) };
      }
      // Same account number recent report
      if (o.accountNumber === newOutage.accountNumber &&
          (Date.now() - new Date(o.reportedAt).getTime()) < 2 * 60 * 60 * 1000) {
        return { isDuplicate: true, existing: o, distanceKm: 'same account' };
      }
    }
    return { isDuplicate: false };
  }

  function createOutage(data) {
    const outage = {
      id: uid(),
      accountNumber: data.accountNumber,
      contactName: data.contactName,
      contactPhone: data.contactPhone,
      contactEmail: data.contactEmail || '',
      type: data.type,
      severity: data.severity,
      affectedCustomers: parseInt(data.affectedCustomers, 10) || 1,
      address: data.address,
      lat: parseFloat(data.lat) || -25.7479,
      lng: parseFloat(data.lng) || 28.2293,
      description: data.description || '',
      reportedAt: now(),
      status: 'Open',
      priority: 0,
      assignedTechId: null,
      assignedAt: null,
      statusHistory: [{ status: 'Open', at: now(), note: 'Reported by customer' }],
      notifications: [],
      workPerformed: '',
      closedAt: null
    };
    outage.priority = priorityScore(outage);
    return outage;
  }

  function addNotification(outage, message) {
    outage.notifications.push({ at: now(), message });
    // In a real system this would send SMS/email/push
    console.log(`[NOTIFY ${outage.contactPhone}] ${message}`);
  }

  function assignTechnician(outageId, techId, notes) {
    const o = outages.find(x => x.id === outageId);
    const t = technicians.find(x => x.id === techId);
    if (!o || !t) return false;
    o.assignedTechId = techId;
    o.assignedAt = now();
    o.status = 'Assigned';
    o.statusHistory.push({ status: 'Assigned', at: now(), note: notes || `Assigned to ${t.name}` });
    t.status = 'busy';
    t.workload = (t.workload || 0) + 1;
    addNotification(o, `Technician ${t.name} has been assigned to your outage. Job ID: ${o.id}`);
    save();
    return true;
  }

  function updateStatus(outageId, newStatus, notes) {
    const o = outages.find(x => x.id === outageId);
    if (!o) return false;
    const prev = o.status;
    o.status = newStatus;
    o.statusHistory.push({ status: newStatus, at: now(), note: notes || '' });

    // Customer notifications
    const msgs = {
      'En Route': 'Your technician is now travelling to the location.',
      'Nearby': 'Technician is nearby and will arrive shortly.',
      'On Site': 'Technician has arrived on site.',
      'In Progress': 'Repair work is in progress.',
      'Resolved': 'The outage has been resolved. Thank you for your patience.',
      'Delayed': `Update: Job delayed. ${notes || ''}`,
      'Reassigned': 'Your job is being reassigned to another technician.'
    };
    if (msgs[newStatus]) addNotification(o, msgs[newStatus]);

    if (newStatus === 'Resolved') {
      o.closedAt = now();
      o.workPerformed = notes || '';
      o.status = 'Resolved';
      // Free technician
      if (o.assignedTechId) {
        const t = technicians.find(x => x.id === o.assignedTechId);
        if (t) {
          t.workload = Math.max(0, (t.workload || 1) - 1);
          if (t.workload === 0) t.status = 'available';
        }
      }
    }

    if (newStatus === 'Reassigned') {
      if (o.assignedTechId) {
        const t = technicians.find(x => x.id === o.assignedTechId);
        if (t) {
          t.workload = Math.max(0, (t.workload || 1) - 1);
          if (t.workload === 0) t.status = 'available';
        }
      }
      o.assignedTechId = null;
      o.status = 'Open';
    }

    // Recalculate priority for open items
    outages.forEach(x => { if (!['Resolved', 'Closed'].includes(x.status)) x.priority = priorityScore(x); });
    save();
    return true;
  }

  function findBestTech(outage) {
    const available = technicians.filter(t => t.status === 'available' || (t.status === 'busy' && t.workload < 2));
    if (!available.length) return null;
    available.sort((a, b) => {
      const da = haversine(a.lat, a.lng, outage.lat, outage.lng);
      const db = haversine(b.lat, b.lng, outage.lat, outage.lng);
      return (da + a.workload * 2) - (db + b.workload * 2);
    });
    return available[0];
  }

  // ---------- Rendering helpers ----------
  function renderOutageCard(o, actionsHtml = '') {
    const tech = o.assignedTechId ? technicians.find(t => t.id === o.assignedTechId) : null;
    return `
      <div class="outage-item ${ (o.severity || '').toLowerCase() }">
        <div class="outage-header">
          <span class="outage-id">${o.id}</span>
          <span class="badge ${badgeClass(o.severity)}">${o.severity}</span>
        </div>
        <div><strong>${o.type}</strong> · ${o.address}</div>
        <div class="outage-meta">
          <span>Status: <span class="badge ${badgeClass(o.status)}">${o.status}</span></span>
          <span>Reported: ${formatTime(o.reportedAt)}</span>
          <span>Affected: ${o.affectedCustomers}</span>
          ${tech ? `<span>Tech: ${tech.name}</span>` : ''}
        </div>
        ${actionsHtml ? `<div class="outage-actions">${actionsHtml}</div>` : ''}
      </div>`;
  }

  // ---------- Page: Dashboard ----------
  function renderDashboard() {
    const open = outages.filter(o => !['Resolved', 'Closed'].includes(o.status));
    const critical = open.filter(o => o.severity === 'Critical');
    const assigned = open.filter(o => o.assignedTechId);
    const today = new Date().toDateString();
    const resolved = outages.filter(o => o.closedAt && new Date(o.closedAt).toDateString() === today);

    document.getElementById('statOpen').textContent = open.length;
    document.getElementById('statCritical').textContent = critical.length;
    document.getElementById('statAssigned').textContent = assigned.length;
    document.getElementById('statResolved').textContent = resolved.length;

    // Recent list
    const recent = [...outages].sort((a, b) => new Date(b.reportedAt) - new Date(a.reportedAt)).slice(0, 8);
    const list = document.getElementById('recentOutages');
    if (list) {
      list.innerHTML = recent.length
        ? recent.map(o => renderOutageCard(o)).join('')
        : '<p class="subtitle">No outages yet. <a href="report.html">Report one</a> or load demo data from Analytics.</p>';
    }

    // Map
    initMap('map', open);
  }

  // ---------- Page: Report ----------
  function initReportPage() {
    const mapEl = document.getElementById('reportMap');
    if (!mapEl) return;
    const map = L.map('reportMap').setView([-25.7479, 28.2293], 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    maps.report = map;

    map.on('click', (e) => {
      const { lat, lng } = e.latlng;
      document.getElementById('lat').value = lat.toFixed(6);
      document.getElementById('lng').value = lng.toFixed(6);
      document.getElementById('coordsHint').textContent = `Location set: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      if (reportMarker) map.removeLayer(reportMarker);
      reportMarker = L.marker([lat, lng]).addTo(map);
    });

    document.getElementById('reportForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {
        accountNumber: document.getElementById('accountNumber').value.trim(),
        contactName: document.getElementById('contactName').value.trim(),
        contactPhone: document.getElementById('contactPhone').value.trim(),
        contactEmail: document.getElementById('contactEmail').value.trim(),
        type: document.getElementById('outageType').value,
        severity: document.getElementById('severity').value,
        affectedCustomers: document.getElementById('affectedCustomers').value,
        address: document.getElementById('address').value.trim(),
        lat: document.getElementById('lat').value,
        lng: document.getElementById('lng').value,
        description: document.getElementById('description').value.trim()
      };

      if (!data.lat || !data.lng) {
        // Default to central Pretoria if no pin
        data.lat = -25.7479;
        data.lng = 28.2293;
      }

      const resultEl = document.getElementById('reportResult');
      const dup = detectDuplicate(data);

      if (dup.isDuplicate) {
        resultEl.className = 'result-box warning';
        resultEl.innerHTML = `
          <strong>Possible duplicate detected</strong><br>
          An existing open outage (${dup.existing.id}) was found nearby / same account
          (${dup.distanceKm} km / match).<br>
          Status: ${dup.existing.status} · Type: ${dup.existing.type}<br>
          <br>Your report has still been logged and linked for reference.
          <br><a href="dispatcher.html">View in Dispatcher Console</a>`;
        // Still create but mark as linked
        const outage = createOutage(data);
        outage.linkedTo = dup.existing.id;
        outage.statusHistory[0].note += ` (Possible duplicate of ${dup.existing.id})`;
        outages.push(outage);
        save();
        resultEl.classList.remove('hidden');
        return;
      }

      const outage = createOutage(data);
      outages.push(outage);
      save();

      resultEl.className = 'result-box success';
      resultEl.innerHTML = `
        <strong>Outage reported successfully</strong><br>
        Job ID: <strong>${outage.id}</strong><br>
        Priority score: ${outage.priority.toFixed(0)} · Severity: ${outage.severity}<br>
        Status: Open – awaiting prioritisation & dispatch.<br>
        You will receive SMS/email updates as the job progresses.<br>
        <br><a href="dispatcher.html">Go to Dispatcher Console</a> · <a href="index.html">Dashboard</a>`;
      resultEl.classList.remove('hidden');
      e.target.reset();
      if (reportMarker) { maps.report.removeLayer(reportMarker); reportMarker = null; }
      document.getElementById('coordsHint').textContent = 'Click the map to set the exact location.';
    });
  }

  // ---------- Page: Dispatcher ----------
  function renderDispatcher() {
    const open = outages.filter(o => !['Resolved', 'Closed'].includes(o.status));
    const pending = open.filter(o => !o.assignedTechId);
    const inProg = open.filter(o => o.assignedTechId && o.status !== 'Resolved');
    const avail = technicians.filter(t => t.status === 'available');

    document.getElementById('dOpen').textContent = open.length;
    document.getElementById('dPending').textContent = pending.length;
    document.getElementById('dInProgress').textContent = inProg.length;
    document.getElementById('dTechs').textContent = avail.length;

    // Sorted queue
    const queue = [...open].sort((a, b) => b.priority - a.priority);
    const queueEl = document.getElementById('outageQueue');
    queueEl.innerHTML = queue.length ? queue.map(o => {
      const actions = o.assignedTechId
        ? `<button class="btn btn-sm btn-secondary" onclick="OutageSystem.viewHistory('${o.id}')">History</button>`
        : `<button class="btn btn-sm btn-primary" onclick="OutageSystem.openAssign('${o.id}')">Assign</button>
           <button class="btn btn-sm btn-success" onclick="OutageSystem.smartAssign('${o.id}')">Smart Assign</button>`;
      return renderOutageCard(o, actions);
    }).join('') : '<p class="subtitle">No open outages.</p>';

    // Tech list
    const techEl = document.getElementById('techList');
    techEl.innerHTML = technicians.map(t => `
      <div class="tech-item">
        <div class="tech-info">
          <strong><span class="status-dot ${t.status === 'available' ? 'available' : t.status === 'busy' ? 'busy' : 'offduty'}"></span>${t.name}</strong>
          <span>${t.id} · Workload: ${t.workload || 0} · ${t.status}</span>
        </div>
      </div>`).join('');

    initMap('dispatchMap', open, true);
  }

  function openAssign(outageId) {
    currentAssignId = outageId;
    const o = outages.find(x => x.id === outageId);
    if (!o) return;
    document.getElementById('assignOutageInfo').textContent =
      `${o.id} – ${o.type} at ${o.address} (${o.severity})`;
    const sel = document.getElementById('selectTech');
    const candidates = technicians.filter(t => t.status !== 'offduty');
    sel.innerHTML = candidates.map(t => {
      const dist = haversine(t.lat, t.lng, o.lat, o.lng).toFixed(1);
      return `<option value="${t.id}">${t.name} (${t.status}, load ${t.workload}, ~${dist} km)</option>`;
    }).join('');
    document.getElementById('assignModal').classList.remove('hidden');
  }

  function confirmAssign() {
    const techId = document.getElementById('selectTech').value;
    const notes = document.getElementById('assignNotes').value;
    if (assignTechnician(currentAssignId, techId, notes)) {
      closeModal();
      renderDispatcher();
    }
  }

  function smartAssign(outageId) {
    const o = outages.find(x => x.id === outageId);
    if (!o) return;
    const best = findBestTech(o);
    if (!best) {
      alert('No available technicians right now.');
      return;
    }
    if (assignTechnician(outageId, best.id, 'Smart auto-assigned by system')) {
      alert(`Assigned to ${best.name}`);
      renderDispatcher();
    }
  }

  function autoAssignAll() {
    const pending = outages.filter(o => !o.assignedTechId && !['Resolved', 'Closed'].includes(o.status));
    let count = 0;
    pending.forEach(o => {
      const best = findBestTech(o);
      if (best && assignTechnician(o.id, best.id, 'Bulk smart auto-assign')) count++;
    });
    alert(`Auto-assigned ${count} outage(s).`);
    renderDispatcher();
  }

  // ---------- Page: Technician ----------
  function renderTechnician() {
    const sel = document.getElementById('techSelect');
    sel.innerHTML = technicians.map(t =>
      `<option value="${t.id}">${t.name} (${t.id}) – ${t.status}</option>`
    ).join('');
    loadTechJobs();
  }

  function loadTechJobs() {
    const techId = document.getElementById('techSelect').value;
    const jobs = outages.filter(o => o.assignedTechId === techId && !['Resolved', 'Closed'].includes(o.status));
    const el = document.getElementById('myJobs');
    el.innerHTML = jobs.length ? jobs.map(o => {
      const actions = `
        <button class="btn btn-sm btn-primary" onclick="OutageSystem.openStatusUpdate('${o.id}')">Update Status</button>
        <button class="btn btn-sm btn-secondary" onclick="OutageSystem.simulateMove('${o.id}')">Simulate GPS Move</button>`;
      return renderOutageCard(o, actions);
    }).join('') : '<p class="subtitle">No active jobs assigned to you.</p>';

    // Map of my jobs
    initMap('techMap', jobs, false, techId);
  }

  function openStatusUpdate(outageId) {
    currentStatusId = outageId;
    const o = outages.find(x => x.id === outageId);
    document.getElementById('statusJobInfo').textContent = `${o.id} – ${o.type} · Current: ${o.status}`;
    document.getElementById('statusModal').classList.remove('hidden');
  }

  function confirmStatusUpdate() {
    const status = document.getElementById('newStatus').value;
    const notes = document.getElementById('statusNotes').value;
    if (updateStatus(currentStatusId, status, notes)) {
      closeModal();
      loadTechJobs();
      // Also refresh if other pages open, but single page view is fine
    }
  }

  function simulateMove(outageId) {
    const o = outages.find(x => x.id === outageId);
    const t = technicians.find(x => x.id === o.assignedTechId);
    if (!t || !o) return;
    // Move tech halfway toward outage
    t.lat = (t.lat + o.lat) / 2;
    t.lng = (t.lng + o.lng) / 2;
    save();
    if (o.status === 'Assigned') updateStatus(outageId, 'En Route', 'Technician departed');
    loadTechJobs();
    alert('Technician location updated (GPS simulation). Status set to En Route if previously Assigned.');
  }

  // ---------- Page: Analytics ----------
  function renderAnalytics() {
    const total = outages.length;
    const resolved = outages.filter(o => o.closedAt);
    document.getElementById('aTotal').textContent = total;
    document.getElementById('aResolvedPct').textContent = total ? Math.round(resolved.length / total * 100) + '%' : '0%';

    // Avg response (report → assigned)
    const withAssign = outages.filter(o => o.assignedAt);
    let avgResp = '—';
    if (withAssign.length) {
      const mins = withAssign.map(o => (new Date(o.assignedAt) - new Date(o.reportedAt)) / 60000);
      avgResp = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    }
    document.getElementById('aAvgResponse').textContent = avgResp;

    // Avg resolution
    let avgRes = '—';
    if (resolved.length) {
      const mins = resolved.map(o => (new Date(o.closedAt) - new Date(o.reportedAt)) / 60000);
      avgRes = Math.round(mins.reduce((a, b) => a + b, 0) / mins.length);
    }
    document.getElementById('aAvgResolution').textContent = avgRes;

    // Charts
    const statusCounts = {};
    outages.forEach(o => { statusCounts[o.status] = (statusCounts[o.status] || 0) + 1; });
    drawPie('statusChart', Object.keys(statusCounts), Object.values(statusCounts),
      ['#0b3d91', '#2a9d8f', '#e9c46a', '#e76f51', '#c1121f', '#5c6b7a']);

    const sevCounts = {};
    outages.forEach(o => { sevCounts[o.severity] = (sevCounts[o.severity] || 0) + 1; });
    drawPie('severityChart', Object.keys(sevCounts), Object.values(sevCounts),
      ['#c1121f', '#e76f51', '#e9c46a', '#2a9d8f']);

    const typeCounts = {};
    outages.forEach(o => { typeCounts[o.type] = (typeCounts[o.type] || 0) + 1; });
    drawBar('typeChart', Object.keys(typeCounts), Object.values(typeCounts));

    // Response times for recent
    const recent = withAssign.slice(-10);
    drawLine('responseChart',
      recent.map(o => o.id.slice(-6)),
      recent.map(o => Math.round((new Date(o.assignedAt) - new Date(o.reportedAt)) / 60000)));

    // Hotspots by address keyword / suburb rough
    const areas = {};
    outages.forEach(o => {
      const key = (o.address || 'Unknown').split(',').pop().trim() || o.address.slice(0, 20);
      areas[key] = (areas[key] || 0) + 1;
    });
    const sorted = Object.entries(areas).sort((a, b) => b[1] - a[1]).slice(0, 8);
    document.getElementById('hotspots').innerHTML = sorted.length
      ? sorted.map(([area, cnt]) => `<div class="hotspot-item"><span>${area}</span><strong>${cnt} outage(s)</strong></div>`).join('')
      : '<p class="subtitle">No data yet.</p>';
  }

  function drawPie(canvasId, labels, data, colors) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: colors || undefined }] },
      options: { plugins: { legend: { position: 'bottom' } }, responsive: true }
    });
  }

  function drawBar(canvasId, labels, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Count', data, backgroundColor: '#0b3d91' }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
    });
  }

  function drawLine(canvasId, labels, data) {
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    if (ctx._chart) ctx._chart.destroy();
    ctx._chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label: 'Minutes to assign', data, borderColor: '#0b3d91', tension: 0.3, fill: false }] },
      options: { scales: { y: { beginAtZero: true } } }
    });
  }

  // ---------- Map helper ----------
  function initMap(elementId, outageList, showTechs = false, focusTechId = null) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (maps[elementId]) {
      maps[elementId].remove();
    }
    const map = L.map(elementId).setView([-25.7479, 28.2293], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    maps[elementId] = map;

    const bounds = [];
    outageList.forEach(o => {
      if (o.lat && o.lng) {
        const color = { Critical: 'red', High: 'orange', Medium: 'gold', Low: 'green' }[o.severity] || 'blue';
        const m = L.circleMarker([o.lat, o.lng], {
          radius: 9, color: '#333', weight: 1, fillColor: color, fillOpacity: 0.85
        }).addTo(map);
        m.bindPopup(`<strong>${o.id}</strong><br>${o.type}<br>${o.severity}<br>${o.status}<br>${o.address}`);
        bounds.push([o.lat, o.lng]);
      }
    });

    if (showTechs || focusTechId) {
      technicians.forEach(t => {
        if (focusTechId && t.id !== focusTechId) return;
        const m = L.marker([t.lat, t.lng]).addTo(map);
        m.bindPopup(`<strong>${t.name}</strong><br>${t.status} · Load: ${t.workload}`);
        bounds.push([t.lat, t.lng]);
      });
    }

    if (bounds.length) map.fitBounds(bounds, { padding: [30, 30] });
  }

  // ---------- Utility actions ----------
  function closeModal() {
    document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
  }

  function viewHistory(id) {
    const o = outages.find(x => x.id === id);
    if (!o) return;
    const hist = o.statusHistory.map(h => `${formatTime(h.at)} – ${h.status}: ${h.note || ''}`).join('\n');
    const notes = o.notifications.map(n => `${formatTime(n.at)}: ${n.message}`).join('\n');
    alert(`History for ${o.id}\n\nStatus changes:\n${hist}\n\nCustomer notifications:\n${notes || 'None'}`);
  }

  function seedDemoData() {
    if (!confirm('Load sample outages and reset technicians to demo state?')) return;
    technicians = JSON.parse(JSON.stringify(DEFAULT_TECHS));
    const samples = [
      { accountNumber: 'TSH-10001', contactName: 'Sarah Mokoena', contactPhone: '+27 82 555 0101', type: 'No Power', severity: 'Critical', affectedCustomers: 120, address: 'Church Street, Pretoria Central', lat: -25.7479, lng: 28.2293, description: 'Entire block without power' },
      { accountNumber: 'TSH-10002', contactName: 'David Botha', contactPhone: '+27 82 555 0102', type: 'Cable Fault', severity: 'High', affectedCustomers: 45, address: 'Lynnwood Road, Lynnwood', lat: -25.7650, lng: 28.2750, description: 'Cable damage after storm' },
      { accountNumber: 'TSH-10003', contactName: 'Fatima Hassan', contactPhone: '+27 82 555 0103', type: 'Voltage Fluctuation', severity: 'Medium', affectedCustomers: 8, address: 'Garsfontein Road, Garsfontein', lat: -25.7800, lng: 28.3200, description: 'Lights flickering' },
      { accountNumber: 'TSH-10004', contactName: 'John Smith', contactPhone: '+27 82 555 0104', type: 'Street Light Failure', severity: 'Low', affectedCustomers: 1, address: 'Sunnyside, Pretoria', lat: -25.7550, lng: 28.2050, description: 'Two poles dark' },
      { accountNumber: 'TSH-10005', contactName: 'Thandi Ndlovu', contactPhone: '+27 82 555 0105', type: 'Transformer Issue', severity: 'Critical', affectedCustomers: 200, address: 'Mamelodi East', lat: -25.7200, lng: 28.3900, description: 'Transformer humming loudly, smoke reported' }
    ];
    outages = samples.map(s => createOutage(s));
    // Pre-assign one
    assignTechnician(outages[1].id, 'T02', 'Demo pre-assignment');
    save();
    alert('Demo data loaded. Refresh or navigate to see it.');
    location.reload();
  }

  function clearAllData() {
    if (!confirm('Clear ALL outages and reset technicians? This cannot be undone.')) return;
    outages = [];
    technicians = JSON.parse(JSON.stringify(DEFAULT_TECHS));
    save();
    location.reload();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify({ outages, technicians }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tshwane-outages-export.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- Public API ----------
  return {
    init: load,
    renderDashboard,
    initReportPage,
    renderDispatcher,
    renderTechnician,
    renderAnalytics,
    openAssign,
    confirmAssign,
    smartAssign,
    autoAssignAll,
    openStatusUpdate,
    confirmStatusUpdate,
    simulateMove,
    loadTechJobs,
    closeModal,
    viewHistory,
    seedDemoData,
    clearAllData,
    exportData
  };
})();
