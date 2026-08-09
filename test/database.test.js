'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../lib/database');

test('edit request indexes enforce one pending request per person', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directory268-db-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const peopleFile = path.join(root, 'people.json');
  const editsFile = path.join(root, 'edits.json');
  fs.writeFileSync(peopleFile, '[]');
  fs.writeFileSync(editsFile, '{}');
  const db = createDatabase({
    dbFile: path.join(root, 'database.sqlite'),
    editsFile,
    peopleFile
  });
  t.after(() => db.close());

  const indexes = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index'`).all()
      .map((row) => row.name)
  );
  assert.equal(indexes.has('idx_edit_requests_status_created_at'), true);
  assert.equal(indexes.has('idx_edit_requests_no_status'), true);
  assert.equal(indexes.has('idx_edit_requests_one_pending_per_person'), true);

  const insert = db.prepare(`
    INSERT INTO edit_requests (no, data, base_version, status, created_at)
    VALUES (1, '{}', 0, ?, '2026-01-01T00:00:00.000Z')
  `);
  insert.run('pending');
  assert.throws(() => insert.run('pending'), /UNIQUE constraint failed/);
  assert.doesNotThrow(() => insert.run('rejected'));
});
