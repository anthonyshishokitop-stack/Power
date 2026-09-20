/**
 * City of Tshwane – Smart Outage Management System
 * Fully operational Express + JWT + Socket.io backend
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const path = require('path');
const { init, getStore, persist } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'tshwane-outage-prod-secret-change-me';
const PORT = process.env.PORT || 3000;
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';

init();
const db = getStore();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: FRONTEND_ORIGIN, methods: ['GET','POST','PUT','PATCH'] } });

app.use(cors({ origin: FRONTEND_ORIGIN }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

function auth(roles = []) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = payload;
      if (roles.length && !roles.includes(payload.role) && payload.role !== 'admin') {
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

function severityScore(s) {
  return { Critical: 100, High: 70, Medium: 40, Low: 15 }[s] || 20;
}
function calcPriority(severity, affected, reportedAt) {
  const sev = severityScore(severity);
  const aff = Math.min((affected || 1) * 2, 50);
  const ageMin = (Date.now() - new Date(reportedAt).getTime()) / 60000;
  return sev + aff + Math.min(ageMin / 2, 30);
}
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function emitOutage(o) { io.emit('outage:updated', o); }
function addHistory(outageId, status, note, actorId) {
  db.statusHistory.push({
    id: db.statusHistory.length + 1,
    outage_id: outageId, status, note: note || null,
    changed_by: actorId || null, created_at: new Date().toISOString()
  });
  persist('statusHistory');
}
function queueNotify(outageId, recipient, message, channel = 'sms') {
  db.notifications.push({
    id: db.notifications.length + 1,
    outage_id: outageId, channel, recipient, message,
    status: 'sent', created_at: new Date().toISOString()
  });
  persist('notifications');
  console.log(`[NOTIFY ${channel.toUpperCase()} → ${recipient}] ${message}`);
  io.emit('notification:new', { outageId, recipient, message });
}
function audit(entityType, entityId, action, actorId, details) {
  db.auditLog.push({
    id: db.auditLog.length + 1,
    entity_type: entityType, entity_id: entityId, action,
    actor_id: actorId || null, details: details || null,
    created_at: new Date().toISOString()
  });
  persist('auditLog');
}
function enrichOutage(o) {
  if (!o) return o;
  const tech = o.assigned_tech_id ? db.technicians.find(t => t.id === o.assigned_tech_id) : null;
  const user = tech ? db.users.find(u => u.id === tech.user_id) : null;
  return {
    ...o,
    tech_code: tech?.employee_code || null,
    tech_name: user?.full_name || null
  };
}

// ---- Auth ----
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.users.find(u => u.email === email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  let techProfile = null;
  if (user.role === 'technician') {
    techProfile = db.technicians.find(t => t.user_id === user.id);
  }
  const token = jwt.sign({
    id: user.id, email: user.email, role: user.role,
    fullName: user.full_name, techId: techProfile?.id || null
  }, JWT_SECRET, { expiresIn: '12h' });
  res.json({
    token,
    user: {
      id: user.id, email: user.email, fullName: user.full_name,
      role: user.role, phone: user.phone,
      techId: techProfile?.id || null,
      employeeCode: techProfile?.employee_code || null
    }
  });
});

app.get('/api/auth/me', auth(), (req, res) => {
  const user = db.users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  let tech = null;
  if (user.role === 'technician') tech = db.technicians.find(t => t.user_id === user.id);
  res.json({
    id: user.id, email: user.email, fullName: user.full_name,
    role: user.role, phone: user.phone,
    techId: tech?.id, employeeCode: tech?.employee_code
  });
});

// ---- Outages ----
app.get('/api/outages', auth(['dispatcher','admin','technician']), (req, res) => {
  let list = db.outages.map(enrichOutage);
  if (req.query.status) list = list.filter(o => o.status === req.query.status);
  if (req.query.severity) list = list.filter(o => o.severity === req.query.severity);
  if (req.query.assigned === 'false') list = list.filter(o => !o.assigned_tech_id);
  if (req.query.assigned === 'true') list = list.filter(o => !!o.assigned_tech_id);
  if (req.user.role === 'technician' && req.user.techId) {
    list = list.filter(o => o.assigned_tech_id === req.user.techId);
  }
  list.sort((a, b) => (b.priority_score || 0) - (a.priority_score || 0));
  res.json(list);
});

app.get('/api/outages/:id', auth(), (req, res) => {
  const o = db.outages.find(x => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Outage not found' });
  const history = db.statusHistory.filter(h => h.outage_id === o.id);
  const notifications = db.notifications.filter(n => n.outage_id === o.id);
  res.json({ ...enrichOutage(o), history, notifications });
});

app.post('/api/outages', auth(), (req, res) => {
  const b = req.body || {};
  if (!b.accountNumber || !b.contactName || !b.contactPhone || !b.type || !b.severity || !b.address) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  const lat = parseFloat(b.lat) || -25.7479;
  const lng = parseFloat(b.lng) || 28.2293;
  const affected = parseInt(b.affectedCustomers, 10) || 1;

  let linkedTo = null;
  const open = db.outages.filter(o => !['Resolved','Closed'].includes(o.status) && o.type === b.type);
  for (const ex of open) {
    if (haversine(ex.lat, ex.lng, lat, lng) <= 0.8) { linkedTo = ex.id; break; }
    if (ex.account_number === b.accountNumber.trim()) {
      const ageH = (Date.now() - new Date(ex.reported_at).getTime()) / 3600000;
      if (ageH < 2) { linkedTo = ex.id; break; }
    }
  }

  const id = 'OUT-' + uuid().slice(0, 8).toUpperCase();
  const reportedAt = new Date().toISOString();
  const outage = {
    id,
    account_number: b.accountNumber.trim(),
    contact_name: b.contactName.trim(),
    contact_phone: b.contactPhone.trim(),
    contact_email: b.contactEmail || null,
    type: b.type, severity: b.severity,
    affected_customers: affected,
    address: b.address.trim(),
    lat, lng,
    description: b.description || null,
    status: 'Open',
    priority_score: calcPriority(b.severity, affected, reportedAt),
    assigned_tech_id: null, assigned_at: null,
    reported_by: req.user.id, reported_at: reportedAt,
    closed_at: null, work_performed: null, linked_to: linkedTo,
    created_at: reportedAt, updated_at: reportedAt
  };
  db.outages.push(outage);
  persist('outages');
  addHistory(id, 'Open', linkedTo ? `Reported (possible duplicate of ${linkedTo})` : 'Reported', req.user.id);
  audit('outage', id, 'create', req.user.id, { type: b.type, severity: b.severity, linkedTo });
  emitOutage(outage);
  res.status(201).json({
    outage,
    duplicateWarning: linkedTo ? { linkedTo, message: 'Possible duplicate detected and linked' } : null
  });
});

app.post('/api/outages/:id/assign', auth(['dispatcher','admin']), (req, res) => {
  const { techId, notes } = req.body || {};
  const outage = db.outages.find(o => o.id === req.params.id);
  if (!outage) return res.status(404).json({ error: 'Outage not found' });
  if (['Resolved','Closed'].includes(outage.status)) return res.status(400).json({ error: 'Cannot assign closed outage' });
  const tech = db.technicians.find(t => t.id === techId);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });
  if (tech.status === 'offduty') return res.status(400).json({ error: 'Technician is off duty' });
  if (tech.workload >= tech.max_jobs) return res.status(400).json({ error: 'Technician at max capacity' });

  const now = new Date().toISOString();
  outage.assigned_tech_id = techId;
  outage.assigned_at = now;
  outage.status = 'Assigned';
  outage.updated_at = now;
  tech.status = 'busy';
  tech.workload = (tech.workload || 0) + 1;
  tech.updated_at = now;
  persist('outages');
  persist('technicians');
  addHistory(outage.id, 'Assigned', notes || `Assigned to ${tech.employee_code}`, req.user.id);
  queueNotify(outage.id, outage.contact_phone,
    `City of Tshwane: Technician ${tech.employee_code} assigned to outage ${outage.id}.`);
  audit('outage', outage.id, 'assign', req.user.id, { techId });
  emitOutage(outage);
  io.emit('tech:updated', tech);
  res.json(enrichOutage(outage));
});

app.post('/api/outages/:id/smart-assign', auth(['dispatcher','admin']), (req, res) => {
  const outage = db.outages.find(o => o.id === req.params.id);
  if (!outage) return res.status(404).json({ error: 'Outage not found' });
  if (outage.assigned_tech_id) return res.status(400).json({ error: 'Already assigned' });
  const candidates = db.technicians.filter(t =>
    (t.status === 'available' || t.status === 'busy') && t.workload < t.max_jobs
  );
  if (!candidates.length) return res.status(409).json({ error: 'No available technicians' });
  candidates.sort((a, b) => {
    const da = haversine(a.lat, a.lng, outage.lat, outage.lng) + a.workload * 2;
    const db_ = haversine(b.lat, b.lng, outage.lat, outage.lng) + b.workload * 2;
    return da - db_;
  });
  const best = candidates[0];
  const now = new Date().toISOString();
  outage.assigned_tech_id = best.id;
  outage.assigned_at = now;
  outage.status = 'Assigned';
  outage.updated_at = now;
  best.status = 'busy';
  best.workload = (best.workload || 0) + 1;
  best.updated_at = now;
  persist('outages');
  persist('technicians');
  addHistory(outage.id, 'Assigned', `Smart assigned to ${best.employee_code}`, req.user.id);
  queueNotify(outage.id, outage.contact_phone,
    `City of Tshwane: Technician ${best.employee_code} assigned to outage ${outage.id}.`);
  audit('outage', outage.id, 'smart-assign', req.user.id, { techId: best.id });
  emitOutage(outage);
  res.json({ outage: enrichOutage(outage), assignedTo: best });
});

app.patch('/api/outages/:id/status', auth(['technician','dispatcher','admin']), (req, res) => {
  const { status, note, workPerformed } = req.body || {};
  const allowed = ['En Route','Nearby','On Site','In Progress','Resolved','Delayed','Closed'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const outage = db.outages.find(o => o.id === req.params.id);
  if (!outage) return res.status(404).json({ error: 'Outage not found' });
  if (req.user.role === 'technician' && outage.assigned_tech_id !== req.user.techId) {
    return res.status(403).json({ error: 'Not your assigned job' });
  }
  const now = new Date().toISOString();
  let finalStatus = status;
  if (status === 'Resolved' || status === 'Closed') {
    finalStatus = 'Resolved';
    outage.closed_at = now;
    if (outage.assigned_tech_id) {
      const tech = db.technicians.find(t => t.id === outage.assigned_tech_id);
      if (tech) {
        tech.workload = Math.max(0, (tech.workload || 1) - 1);
        if (tech.workload === 0) tech.status = 'available';
        tech.updated_at = now;
        persist('technicians');
      }
    }
  }
  outage.status = finalStatus;
  if (workPerformed || note) outage.work_performed = workPerformed || note;
  outage.updated_at = now;
  persist('outages');
  addHistory(outage.id, finalStatus, note || workPerformed || '', req.user.id);

  const msgs = {
    'En Route': 'Your technician is travelling to the location.',
    'Nearby': 'Technician is nearby and will arrive shortly.',
    'On Site': 'Technician has arrived on site.',
    'In Progress': 'Repair work is now in progress.',
    'Resolved': 'The outage has been resolved. Thank you for your patience.',
    'Delayed': `Update: Job delayed. ${note || ''}`,
    'Closed': 'Job closed.'
  };
  if (msgs[status]) {
    queueNotify(outage.id, outage.contact_phone, `City of Tshwane [${outage.id}]: ${msgs[status]}`);
  }
  audit('outage', outage.id, 'status_change', req.user.id, { to: finalStatus });

  // Recalc priorities
  db.outages.forEach(o => {
    if (!['Resolved','Closed'].includes(o.status)) {
      o.priority_score = calcPriority(o.severity, o.affected_customers, o.reported_at);
    }
  });
  persist('outages');
  emitOutage(outage);
  res.json(enrichOutage(outage));
});

app.patch('/api/technicians/me/location', auth(['technician']), (req, res) => {
  const { lat, lng } = req.body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'lat and lng required as numbers' });
  }
  const tech = db.technicians.find(t => t.user_id === req.user.id);
  if (!tech) return res.status(404).json({ error: 'Technician profile not found' });
  tech.lat = lat; tech.lng = lng; tech.updated_at = new Date().toISOString();
  persist('technicians');
  io.emit('tech:location', tech);
  res.json(tech);
});

app.get('/api/technicians', auth(['dispatcher','admin','technician']), (req, res) => {
  const rows = db.technicians.map(t => {
    const u = db.users.find(x => x.id === t.user_id);
    return { ...t, full_name: u?.full_name, phone: u?.phone, email: u?.email };
  });
  res.json(rows);
});

app.get('/api/analytics/summary', auth(['dispatcher','admin']), (req, res) => {
  const total = db.outages.length;
  const open = db.outages.filter(o => !['Resolved','Closed'].includes(o.status)).length;
  const resolved = db.outages.filter(o => ['Resolved','Closed'].includes(o.status)).length;
  const critical = db.outages.filter(o => o.severity === 'Critical' && !['Resolved','Closed'].includes(o.status)).length;

  const withAssign = db.outages.filter(o => o.assigned_at);
  const avgResponse = withAssign.length
    ? Math.round(withAssign.reduce((s, o) => s + (new Date(o.assigned_at) - new Date(o.reported_at)) / 60000, 0) / withAssign.length)
    : null;
  const withClose = db.outages.filter(o => o.closed_at);
  const avgResolution = withClose.length
    ? Math.round(withClose.reduce((s, o) => s + (new Date(o.closed_at) - new Date(o.reported_at)) / 60000, 0) / withClose.length)
    : null;

  const byStatus = {}, bySeverity = {}, byType = {};
  db.outages.forEach(o => {
    byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    bySeverity[o.severity] = (bySeverity[o.severity] || 0) + 1;
    byType[o.type] = (byType[o.type] || 0) + 1;
  });

  res.json({
    total, open, resolved, critical,
    avgResponseMinutes: avgResponse,
    avgResolutionMinutes: avgResolution,
    resolutionRate: total ? Math.round((resolved / total) * 100) : 0,
    byStatus: Object.entries(byStatus).map(([status, count]) => ({ status, count })),
    bySeverity: Object.entries(bySeverity).map(([severity, count]) => ({ severity, count })),
    byType: Object.entries(byType).map(([type, count]) => ({ type, count })).sort((a,b) => b.count - a.count)
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'tshwane-outage-ops', time: new Date().toISOString() });
});

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('[WS] connected', socket.id);
  socket.on('disconnect', () => console.log('[WS] disconnected', socket.id));
});

server.listen(PORT, () => {
  console.log(`\n⚡ City of Tshwane Outage Management API`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
