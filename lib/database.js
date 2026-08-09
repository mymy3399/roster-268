'use strict';

const fs = require('fs');
const Database = require('better-sqlite3');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function createDatabase({ dbFile, editsFile, peopleFile }) {
  const db = new Database(dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS people (
      no INTEGER PRIMARY KEY,
      rank TEXT,
      name TEXT,
      nick TEXT,
      pos TEXT,
      phone TEXT,
      unit TEXT,
      batch TEXT,
      t TEXT,
      birth TEXT,
      age TEXT
    );

    CREATE TABLE IF NOT EXISTS edits (
      no INTEGER PRIMARY KEY,
      data TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS edit_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      no INTEGER NOT NULL,
      data TEXT NOT NULL,
      base_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      reviewed_at TEXT
    );
  `);

  const editColumns = db.prepare('PRAGMA table_info(edits)').all()
    .map((column) => column.name);
  if (!editColumns.includes('version')) {
    db.exec('ALTER TABLE edits ADD COLUMN version INTEGER NOT NULL DEFAULT 1');
  }
  if (!editColumns.includes('updated_at')) {
    db.exec('ALTER TABLE edits ADD COLUMN updated_at TEXT');
  }

  db.exec(`
    UPDATE edit_requests
    SET status = 'replaced', reviewed_at = COALESCE(reviewed_at, datetime('now'))
    WHERE status = 'pending'
      AND id NOT IN (
        SELECT MAX(id) FROM edit_requests
        WHERE status = 'pending'
        GROUP BY no
      );

    CREATE INDEX IF NOT EXISTS idx_edit_requests_status_created_at
      ON edit_requests(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_edit_requests_no_status
      ON edit_requests(no, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_edit_requests_one_pending_per_person
      ON edit_requests(no) WHERE status = 'pending';
  `);

  seedPeople(db, readJson(peopleFile, []));
  seedEdits(db, readJson(editsFile, {}));
  return db;
}

function seedPeople(db, people) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM people').get();
  if (count !== 0 || !Array.isArray(people)) return;

  const insert = db.prepare(`
    INSERT INTO people (no, rank, name, nick, pos, phone, unit, batch, t, birth, age)
    VALUES (@no, @rank, @name, @nick, @pos, @phone, @unit, @batch, @t, @birth, @age)
  `);
  db.transaction((records) => {
    for (const person of records) {
      insert.run({
        no: person.no,
        rank: person.rank || '',
        name: person.name || '',
        nick: person.nick || '',
        pos: person.pos || '',
        phone: person.phone || '',
        unit: person.unit || '',
        batch: person.batch || '',
        t: person.t || '',
        birth: person.birth || '',
        age: person.age || ''
      });
    }
  })(people);
  console.log(`Seeded ${people.length} people records into SQLite DB.`);
}

function seedEdits(db, edits) {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM edits').get();
  if (count !== 0 || !edits || typeof edits !== 'object' || Array.isArray(edits)) return;

  const insert = db.prepare('INSERT OR REPLACE INTO edits (no, data) VALUES (?, ?)');
  db.transaction((entries) => {
    for (const [number, data] of entries) {
      insert.run(Number(number), JSON.stringify(data));
    }
  })(Object.entries(edits));
}

module.exports = { createDatabase, readJson };
