'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { createDatabase } = require('../lib/database');

test('links table stores and retrieves links correctly', () => {
  const dbFile = path.join(__dirname, 'test_links.sqlite');
  const fs = require('fs');
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);

  const db = createDatabase({
    dbFile,
    editsFile: path.join(__dirname, 'fixtures', 'edits.json'),
    peopleFile: path.join(__dirname, 'fixtures', 'people.json')
  });

  // Insert a test link
  const insert = db.prepare(`
    INSERT INTO links (title, url, description, created_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
  const info = insert.run('วิทยาลัยการตำรวจ', 'https://tc.police.go.th', 'เว็บไซต์หลัก');
  assert.ok(info.lastInsertRowid > 0);

  const links = db.prepare('SELECT * FROM links ORDER BY id DESC').all();
  assert.equal(links.length, 1);
  assert.equal(links[0].title, 'วิทยาลัยการตำรวจ');
  assert.equal(links[0].url, 'https://tc.police.go.th');

  // Delete test link
  db.prepare('DELETE FROM links WHERE id = ?').run(info.lastInsertRowid);
  const remaining = db.prepare('SELECT * FROM links').all();
  assert.equal(remaining.length, 0);

  db.close();
  if (fs.existsSync(dbFile)) fs.unlinkSync(dbFile);
});
