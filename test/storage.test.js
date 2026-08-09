'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  cleanupOrphanedPendingPhotos,
  deletePendingPhoto,
  pendingPhotoPath,
  promotePendingPhoto,
  writePendingPhoto
} = require('../lib/storage');

test('pending photos are stored, promoted and deleted safely', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directory268-storage-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pendingDir = path.join(root, 'pending');
  const photosDir = path.join(root, 'photos');
  fs.mkdirSync(photosDir);

  const pendingUrl = writePendingPhoto(pendingDir, 12, {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    extension: 'jpg'
  });
  assert.match(pendingUrl, /^\/data\/photo\/pending_12_/);
  assert.equal(fs.existsSync(pendingPhotoPath(pendingDir, pendingUrl)), true);

  const promoted = promotePendingPhoto(pendingDir, photosDir, pendingUrl, 12, 3);
  assert.equal(promoted.photoUrl, '/photos/edited_12_v3.jpg');
  assert.equal(fs.readFileSync(promoted.destinationPath).length, 4);

  deletePendingPhoto(pendingDir, pendingUrl);
  assert.equal(fs.existsSync(pendingPhotoPath(pendingDir, pendingUrl)), false);
});

test('orphan cleanup preserves only active pending photos', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'directory268-cleanup-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = writePendingPhoto(root, 1, { buffer: Buffer.from('a'), extension: 'jpg' });
  const orphan = writePendingPhoto(root, 2, { buffer: Buffer.from('b'), extension: 'jpg' });

  cleanupOrphanedPendingPhotos(root, [active]);
  assert.equal(fs.existsSync(pendingPhotoPath(root, active)), true);
  assert.equal(fs.existsSync(pendingPhotoPath(root, orphan)), false);
});
