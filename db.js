/**
 * Persistent data store – pure JavaScript (no native modules).
 * Data is saved to JSON files under ./data/
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');

const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : path.join(__dirname, 'data');

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  technicians: path.join(DATA_DIR, 'technicians.json'),
  outages: path.join(DATA_DIR, 'outages.json'),
  statusHistory: path.join(DATA_DIR, 'status_history.json'),
  notifications: path.join(DATA_DIR, 'notifications.json'),
  auditLog: path.join(DATA_DIR, 'audit_log.json')
};

const store = {
  users: [],
  technicians: [],
  outages: [],
  statusHistory: [],
  notifications: [],
  auditLog: []
};

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(key) {
  const file = FILES[key];
  if (fs.existsSync(file)) {
    try {
      store[key] = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      store[key] = [];
    }
  } else {
    store[key] = [];
  }
}

function save(key) {
  ensureDir();
  fs.writeFileSync(FILES[key], JSON.stringify(store[key], null, 2));
}

function saveAll() {
  Object.keys(FILES).forEach(save);
}

function init() {
  ensureDir();
  Object.keys(FILES).forEach(load);
  if (store.users.length === 0) seedDefaults();
  return store;
}

function seedDefaults() {
  store.users.push({
    id: uuid(),
    email: 'admin@tshwane.gov.za',
    password_hash: bcrypt.hashSync('Admin@123', 10),
    full_name: 'System Administrator',
    role: 'admin',
    phone: '+27 12 000 0000',
    created_at: new Date().toISOString()
  });
  store.users.push({
    id: uuid(),
    email: 'dispatcher@tshwane.gov.za',
    password_hash: bcrypt.hashSync('Dispatch@123', 10),
    full_name: 'Central Dispatcher',
    role: 'dispatcher',
    phone: '+27 12 000 0001',
    created_at: new Date().toISOString()
  });

  const techs = [
    { code: 'T01', name: 'Thabo Molefe', email: 'thabo.molefe@tshwane.gov.za', lat: -25.7479, lng: 28.2293, phone: '+27 82 100 1001' },
    { code: 'T02', name: 'Lerato Nkosi', email: 'lerato.nkosi@tshwane.gov.za', lat: -25.7520, lng: 28.1880, phone: '+27 82 100 1002' },
    { code: 'T03', name: 'Johan van der Berg', email: 'johan.vdberg@tshwane.gov.za', lat: -25.7310, lng: 28.2180, phone: '+27 82 100 1003' },
    { code: 'T04', name: 'Nomsa Dlamini', email: 'nomsa.dlamini@tshwane.gov.za', lat: -25.7650, lng: 28.2750, phone: '+27 82 100 1004' },
    { code: 'T05', name: 'Pieter Botha', email: 'pieter.botha@tshwane.gov.za', lat: -25.7100, lng: 28.2000, phone: '+27 82 100 1005' }
  ];
  const techHash = bcrypt.hashSync('Tech@123', 10);
  for (const t of techs) {
    const uid = uuid();
    const tid = uuid();
    store.users.push({
      id: uid, email: t.email, password_hash: techHash,
      full_name: t.name, role: 'technician', phone: t.phone,
      created_at: new Date().toISOString()
    });
    store.technicians.push({
      id: tid, user_id: uid, employee_code: t.code, status: 'available',
      lat: t.lat, lng: t.lng, workload: 0, max_jobs: 3,
      skills: ['electrical', 'cable', 'transformer'],
      updated_at: new Date().toISOString()
    });
  }
  saveAll();
  console.log('[DB] Default users seeded');
  console.log('  admin@tshwane.gov.za / Admin@123');
  console.log('  dispatcher@tshwane.gov.za / Dispatch@123');
  console.log('  technician emails / Tech@123');
}

function getStore() { return store; }
function persist(key) { save(key); }

module.exports = { init, getStore, persist, saveAll };
