const express = require('express');
const fs = require('fs');
const path = require('path');
const { createAdminAuth } = require('./lib/admin-auth');
const { createDatabase, readJson } = require('./lib/database');
const {
  decodeDataImage,
  parsePositiveInteger,
  parseVersion,
  sanitizeEditData,
  sanitizeNewPerson
} = require('./lib/validation');
const {
  cleanupOrphanedPendingPhotos,
  deleteManagedPhoto,
  deletePendingPhoto,
  pendingPhotoPath,
  promotePendingPhoto,
  writeEditsBackup,
  writePendingPhoto,
  writePeopleBackup
} = require('./lib/storage');
const { createEditRequestGuard } = require('./lib/request-limits');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN;
if (!ADMIN_PIN) throw new Error('ADMIN_PIN is required');
const adminAuth = createAdminAuth(ADMIN_PIN);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'"
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()'
  });
  next();
});

// Edit uploads are rate/concurrency limited before their JSON bodies are parsed.
app.use(createEditRequestGuard());
app.use(express.json({ limit: '2mb', strict: true }));

const DATA_DIR = path.join(__dirname, 'data');
const NEW_PHOTOS_DIR = path.join(DATA_DIR, 'photo');
const PHOTOS_DIR = path.join(__dirname, 'public', 'photos');
const PEOPLE_FILE = path.join(DATA_DIR, 'people.json');
const COMMITTEE_ROLES_FILE = path.join(DATA_DIR, 'committee-roles.json');
const EDITS_FILE = path.join(DATA_DIR, 'edits.json');
const DB_FILE = path.join(DATA_DIR, 'database.sqlite');

// Ensure database & storage directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(PHOTOS_DIR)) {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

// Portrait URLs are versioned by the client, so browsers can keep the heavy
// assets locally instead of re-downloading them on every visit.
const PHOTO_CACHE_OPTIONS = {
  maxAge: '30d',
  immutable: true,
  etag: true
};
app.use('/photos', express.static(PHOTOS_DIR, PHOTO_CACHE_OPTIONS));
app.use('/data/photo', express.static(NEW_PHOTOS_DIR, PHOTO_CACHE_OPTIONS));
app.use(express.static(path.join(__dirname, 'public')));

const committeeRoles = readJson(COMMITTEE_ROLES_FILE, {});
const db = createDatabase({ dbFile: DB_FILE, editsFile: EDITS_FILE, peopleFile: PEOPLE_FILE });

const PENDING_REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function storedRequestData(rawData) {
  const input = { ...rawData };
  const pendingPhoto = pendingPhotoPath(NEW_PHOTOS_DIR, input.t) ? input.t : null;
  if (pendingPhoto) delete input.t;
  const data = sanitizeEditData(input);
  if (pendingPhoto) data.t = pendingPhoto;
  return data;
}

function cleanupPendingRequests() {
  const cutoff = new Date(Date.now() - PENDING_REQUEST_TTL_MS).toISOString();
  const expired = db.prepare(`
    SELECT id, data FROM edit_requests
    WHERE status = 'pending' AND created_at < ?
  `).all(cutoff);
  const expire = db.transaction((rows) => {
    const statement = db.prepare(`
      UPDATE edit_requests SET status = 'expired', reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `);
    const now = new Date().toISOString();
    for (const row of rows) statement.run(now, row.id);
  });
  expire(expired);
  for (const row of expired) {
    try {
      deletePendingPhoto(NEW_PHOTOS_DIR, JSON.parse(row.data).t);
    } catch (error) {}
  }

  const activePhotoUrls = db.prepare(`
    SELECT data FROM edit_requests WHERE status = 'pending'
  `).all().flatMap((row) => {
    try {
      const photoUrl = JSON.parse(row.data).t;
      return photoUrl ? [photoUrl] : [];
    } catch (error) {
      return [];
    }
  });
  cleanupOrphanedPendingPhotos(NEW_PHOTOS_DIR, activePhotoUrls);
}

cleanupPendingRequests();
setInterval(cleanupPendingRequests, 60 * 60 * 1000).unref();

// Serve root client application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Read-only fallback used when the database endpoint is temporarily unavailable
app.get('/data/people.json', (req, res) => {
  try {
    const people = JSON.parse(fs.readFileSync(PEOPLE_FILE, 'utf8'))
      .map((person) => ({
        ...person,
        committeeRole: committeeRoles[person.no] || ''
      }));
    res.json(people);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load people data' });
  }
});

// Endpoint to fetch all people records from SQLite DB
app.get('/api/people', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const people = db.prepare('SELECT * FROM people ORDER BY no ASC').all()
      .map((person) => ({
        ...person,
        committeeRole: committeeRoles[person.no] || ''
      }));
    res.json(people);
  } catch (e) {
    console.error('Error fetching people:', e);
    res.status(500).json({ error: 'Failed to fetch people' });
  }
});

// Endpoint to fetch all profile edits
app.get('/api/edits', (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const rows = db.prepare('SELECT no, data FROM edits').all();
    const editsMap = {};
    for (const row of rows) {
      try {
        editsMap[row.no] = JSON.parse(row.data);
      } catch (e) {}
    }
    res.json(editsMap);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch edits' });
  }
});

const { isAdmin, login, logout, requireAdmin } = adminAuth;

app.post('/api/admin/login', login);
app.post('/api/admin/logout', requireAdmin, logout);

app.get('/api/admin/session', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ admin: isAdmin(req) });
});

app.get('/api/edit-requests/pending-count', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM edit_requests WHERE status = 'pending'
  `).get();
  res.json({ count: row.count });
});

app.post('/api/edit-requests/:no', (req, res) => {
  const no = parsePositiveInteger(req.params.no, 'person number');
  const expectedVersion = parseVersion(req.body.expectedVersion);
  const data = sanitizeEditData(req.body.data);
  const person = db.prepare('SELECT 1 FROM people WHERE no = ?').get(no);
  if (!person) return res.status(404).json({ error: 'Person not found' });
  const current = db.prepare('SELECT version FROM edits WHERE no = ?').get(no);
  const currentVersion = current ? (current.version || 1) : 0;
  if (currentVersion !== expectedVersion) {
    return res.status(409).json({ error: 'Data changed', currentVersion });
  }

  let newPendingPhoto = null;
  if (data.t && data.t.startsWith('data:image/')) {
    newPendingPhoto = writePendingPhoto(NEW_PHOTOS_DIR, no, decodeDataImage(data.t));
    data.t = newPendingPhoto;
  }

  const createdAt = new Date().toISOString();
  try {
    const saveRequest = db.transaction(() => {
      const existing = db.prepare(`
        SELECT id, data FROM edit_requests WHERE no = ? AND status = 'pending'
      `).get(no);
      if (existing) {
        db.prepare(`
          UPDATE edit_requests
          SET data = ?, base_version = ?, created_at = ?, reviewed_at = NULL
          WHERE id = ?
        `).run(JSON.stringify(data), expectedVersion, createdAt, existing.id);
        return { id: existing.id, previousData: existing.data, replaced: true };
      }
      const result = db.prepare(`
        INSERT INTO edit_requests (no, data, base_version, status, created_at)
        VALUES (?, ?, ?, 'pending', ?)
      `).run(no, JSON.stringify(data), expectedVersion, createdAt);
      return { id: result.lastInsertRowid, previousData: null, replaced: false };
    });
    const result = saveRequest();
    if (result.previousData) {
      try {
        const previousPhoto = JSON.parse(result.previousData).t;
        if (previousPhoto !== data.t) deletePendingPhoto(NEW_PHOTOS_DIR, previousPhoto);
      } catch (error) {}
    }
    return res.status(202).json({
      id: result.id,
      status: 'pending',
      replaced: result.replaced,
      createdAt
    });
  } catch (error) {
    if (newPendingPhoto) deletePendingPhoto(NEW_PHOTOS_DIR, newPendingPhoto);
    throw error;
  }
});

app.get('/api/admin/edit-requests', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare(`
    SELECT r.id, r.no, r.data, r.base_version, r.created_at, p.rank, p.name
    FROM edit_requests r LEFT JOIN people p ON p.no = r.no
    WHERE r.status = 'pending' ORDER BY r.created_at ASC
  `).all();
  res.json(rows.map((row) => {
    const data = JSON.parse(row.data);
    if (data.t) data.t = '__IMAGE__';
    return { ...row, data };
  }));
});

app.get('/api/admin/edit-history', requireAdmin, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const rows = db.prepare(`
    SELECT r.id, r.no, r.data, r.status, r.created_at, r.reviewed_at, p.rank, p.name
    FROM edit_requests r LEFT JOIN people p ON p.no = r.no
    WHERE r.status IN ('approved', 'reverted')
    ORDER BY COALESCE(r.reviewed_at, r.created_at) DESC
    LIMIT 100
  `).all();
  res.json(rows.map((row) => {
    let data = {};
    try { data = JSON.parse(row.data); } catch (e) {}
    if (data.t) data.t = '__IMAGE__';
    return { ...row, data };
  }));
});

// Versioned per-person edit API. This prevents stale devices overwriting newer data.
app.get('/api/edits/:no', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const no = parsePositiveInteger(req.params.no, 'person number');
  const row = db.prepare('SELECT data, version, updated_at FROM edits WHERE no = ?').get(no);
  if (!row) return res.json({ no, data: {}, version: 0, updatedAt: null });
  try {
    return res.json({
      no,
      data: JSON.parse(row.data),
      version: row.version || 1,
      updatedAt: row.updated_at || null
    });
  } catch (e) {
    return res.status(500).json({ error: 'Invalid stored edit data' });
  }
});

app.put('/api/edits/:no', requireAdmin, (req, res) => {
  const no = parsePositiveInteger(req.params.no, 'person number');
  const expectedVersion = parseVersion(req.body.expectedVersion);
  const incomingData = sanitizeEditData(req.body.data);
  const person = db.prepare('SELECT 1 FROM people WHERE no = ?').get(no);
  if (!person) return res.status(404).json({ error: 'Person not found' });

  const saveVersionedEdit = db.transaction(() => {
    const current = db.prepare('SELECT data, version FROM edits WHERE no = ?').get(no);
    const currentVersion = current ? (current.version || 1) : 0;
    if (currentVersion !== expectedVersion) {
      return { conflict: true, current, currentVersion };
    }

    const data = { ...incomingData };
    const nextVersion = currentVersion + 1;
    if (data.t && data.t.startsWith('data:image/')) {
      const { buffer, extension } = decodeDataImage(data.t);
      const filename = `edited_${no}_v${nextVersion}.${extension}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer, { flag: 'wx' });
      data.t = `/photos/${filename}`;
    }

    const previousData = current ? JSON.parse(current.data) : {};
    if (previousData.t && previousData.t !== data.t) {
      deleteManagedPhoto(PHOTOS_DIR, previousData.t);
    }

    const updatedAt = new Date().toISOString();
    db.prepare(`
      INSERT INTO edits (no, data, version, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(no) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at
    `).run(no, JSON.stringify(data), nextVersion, updatedAt);
    return { conflict: false, data, version: nextVersion, updatedAt };
  });

  try {
    const result = saveVersionedEdit();
    if (result.conflict) {
      let currentData = {};
      try { currentData = result.current ? JSON.parse(result.current.data) : {}; } catch (e) {}
      return res.status(409).json({
        error: 'Edit conflict',
        current: { data: currentData, version: result.currentVersion }
      });
    }
    writeEditsBackup(db, EDITS_FILE);
    return res.json({ no, data: result.data, version: result.version, updatedAt: result.updatedAt });
  } catch (e) {
    console.error('Error saving versioned edit:', e);
    return res.status(500).json({ error: 'Failed to save edit' });
  }
});

app.post('/api/admin/edit-requests/:id/approve', requireAdmin, (req, res) => {
  const id = parsePositiveInteger(req.params.id, 'request id');
  const requestRow = db.prepare(`
    SELECT id, no, data, base_version FROM edit_requests WHERE id = ? AND status = 'pending'
  `).get(id);
  if (!requestRow) return res.status(404).json({ error: 'Pending request not found' });

  try {
    const data = storedRequestData(JSON.parse(requestRow.data));
    const current = db.prepare('SELECT data, version FROM edits WHERE no = ?').get(requestRow.no);
    const currentVersion = current ? (current.version || 1) : 0;
    if (currentVersion !== requestRow.base_version) {
      return res.status(409).json({ error: 'Data changed after this request was submitted' });
    }

    const nextVersion = currentVersion + 1;
    let promotedPhoto = null;
    const pendingPhoto = pendingPhotoPath(NEW_PHOTOS_DIR, data.t) ? data.t : null;
    if (pendingPhoto) {
      promotedPhoto = promotePendingPhoto(
        NEW_PHOTOS_DIR,
        PHOTOS_DIR,
        pendingPhoto,
        requestRow.no,
        nextVersion
      );
      data.t = promotedPhoto.photoUrl;
    } else if (data.t && data.t.startsWith('data:image/')) {
      const { buffer, extension } = decodeDataImage(data.t);
      const filename = `edited_${requestRow.no}_v${nextVersion}.${extension}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer, { flag: 'wx' });
      data.t = `/photos/${filename}`;
    }

    let previousData = {};
    try { previousData = current ? JSON.parse(current.data) : {}; } catch (e) {}
    if (previousData.t && previousData.t !== data.t) {
      deleteManagedPhoto(PHOTOS_DIR, previousData.t);
    }

    const now = new Date().toISOString();
    const approve = db.transaction(() => {
      db.prepare(`
        INSERT INTO edits (no, data, version, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(no) DO UPDATE SET data=excluded.data, version=excluded.version, updated_at=excluded.updated_at
      `).run(requestRow.no, JSON.stringify(data), nextVersion, now);
      db.prepare(`UPDATE edit_requests SET status='approved', reviewed_at=? WHERE id=?`).run(now, id);
    });
    try {
      approve();
    } catch (error) {
      if (promotedPhoto && fs.existsSync(promotedPhoto.destinationPath)) {
        fs.unlinkSync(promotedPhoto.destinationPath);
      }
      throw error;
    }
    if (pendingPhoto) deletePendingPhoto(NEW_PHOTOS_DIR, pendingPhoto);
    writeEditsBackup(db, EDITS_FILE);
    res.json({ ok: true, no: requestRow.no, data, version: nextVersion });
  } catch (e) {
    console.error('Approval failed:', e);
    res.status(500).json({ error: 'Approval failed' });
  }
});

app.post('/api/admin/edit-requests/:id/reject', requireAdmin, (req, res) => {
  const id = parsePositiveInteger(req.params.id, 'request id');
  const requestRow = db.prepare(`
    SELECT data FROM edit_requests WHERE id = ? AND status = 'pending'
  `).get(id);
  if (!requestRow) return res.status(404).json({ error: 'Pending request not found' });
  const result = db.prepare(`
    UPDATE edit_requests SET status='rejected', reviewed_at=?
    WHERE id=? AND status='pending'
  `).run(new Date().toISOString(), id);
  if (!result.changes) return res.status(404).json({ error: 'Pending request not found' });
  try {
    deletePendingPhoto(NEW_PHOTOS_DIR, JSON.parse(requestRow.data).t);
  } catch (error) {}
  res.json({ ok: true });
});

app.post('/api/admin/edit-requests/:id/revert', requireAdmin, (req, res) => {
  const id = parsePositiveInteger(req.params.id, 'request id');
  const requestRow = db.prepare(`
    SELECT id, no FROM edit_requests WHERE id = ? AND status = 'approved'
  `).get(id);
  if (!requestRow) return res.status(404).json({ error: 'Approved request not found' });

  try {
    const current = db.prepare('SELECT data, version FROM edits WHERE no = ?').get(requestRow.no);
    const nextVersion = (current ? (current.version || 1) : 0) + 1;
    const now = new Date().toISOString();
    const revert = db.transaction(() => {
      db.prepare(`
        INSERT INTO edits (no, data, version, updated_at) VALUES (?, '{}', ?, ?)
        ON CONFLICT(no) DO UPDATE SET data='{}', version=excluded.version, updated_at=excluded.updated_at
      `).run(requestRow.no, nextVersion, now);
      db.prepare(`
        UPDATE edit_requests SET status='reverted', reviewed_at=?
        WHERE no=? AND status='approved'
      `).run(now, requestRow.no);
    });
    revert();

    if (current && current.data) {
      try {
        deleteManagedPhoto(PHOTOS_DIR, JSON.parse(current.data).t);
      } catch (e) {}
    }

    writeEditsBackup(db, EDITS_FILE);
    res.json({ ok: true, no: requestRow.no, data: {}, version: nextVersion });
  } catch (e) {
    console.error('Revert approved edit failed:', e);
    res.status(500).json({ error: 'Revert failed' });
  }
});

// Disabled for writes: old clients sent the entire map and could erase newer edits.
app.post('/api/edits', (req, res) => {
  res.status(409).json({
    error: 'This app version is outdated. Refresh before editing.',
    code: 'APP_UPDATE_REQUIRED'
  });
});

// Endpoint to add a NEW person + photo to the SQLite DB
app.post('/api/people', requireAdmin, (req, res) => {
  try {
    const p = sanitizeNewPerson(req.body);
    
    // Auto-increment / determine next 'no'
    const maxRow = db.prepare('SELECT MAX(no) as maxNo FROM people').get();
    const newNo = (maxRow.maxNo || 0) + 1;

    let photoPath = p.t;
    if (photoPath && photoPath.startsWith('data:image/')) {
      const { buffer, extension } = decodeDataImage(photoPath);
      const filename = `person_${newNo}.${extension}`;
      fs.writeFileSync(path.join(PHOTOS_DIR, filename), buffer, { flag: 'wx' });
      photoPath = `/photos/${filename}`;
    }

    const newPerson = {
      no: newNo,
      rank: p.rank,
      name: p.name,
      nick: p.nick,
      pos: p.pos,
      phone: p.phone,
      unit: p.unit,
      batch: p.batch,
      t: photoPath,
      birth: p.birth,
      age: p.age
    };

    db.prepare(`
      INSERT INTO people (no, rank, name, nick, pos, phone, unit, batch, t, birth, age)
      VALUES (@no, @rank, @name, @nick, @pos, @phone, @unit, @batch, @t, @birth, @age)
    `).run(newPerson);

    // Sync JSON file backup
    writePeopleBackup(db, PEOPLE_FILE);

    res.status(201).json(newPerson);
  } catch (e) {
    console.error('Error creating new person:', e);
    res.status(e.statusCode || 500).json({
      error: e.statusCode ? e.message : 'Failed to create new person'
    });
  }
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body is too large' });
  }
  if (error.statusCode && error.statusCode < 500) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  console.error('Unhandled request error:', error);
  return res.status(500).json({ error: 'Internal server error' });
});

// Start Express server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
