'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const PENDING_PHOTO_PATTERN = /^\/data\/photo\/pending_(\d+)_([a-f0-9-]+)\.(jpg|png|webp)$/i;

function pendingPhotoPath(pendingPhotosDir, photoUrl) {
  const match = PENDING_PHOTO_PATTERN.exec(String(photoUrl || ''));
  if (!match) return null;
  return path.join(pendingPhotosDir, path.basename(photoUrl));
}

function writePendingPhoto(pendingPhotosDir, no, decodedImage) {
  fs.mkdirSync(pendingPhotosDir, { recursive: true });
  const filename = `pending_${no}_${crypto.randomUUID()}.${decodedImage.extension}`;
  fs.writeFileSync(path.join(pendingPhotosDir, filename), decodedImage.buffer, { flag: 'wx' });
  return `/data/photo/${filename}`;
}

function deletePendingPhoto(pendingPhotosDir, photoUrl) {
  const photoPath = pendingPhotoPath(pendingPhotosDir, photoUrl);
  if (photoPath && fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
}

function promotePendingPhoto(pendingPhotosDir, photosDir, photoUrl, no, version) {
  const sourcePath = pendingPhotoPath(pendingPhotosDir, photoUrl);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    const error = new Error('Pending photo is missing');
    error.statusCode = 409;
    throw error;
  }
  const extension = path.extname(sourcePath).slice(1).toLowerCase();
  const filename = `edited_${no}_v${version}.${extension}`;
  const destinationPath = path.join(photosDir, filename);
  fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
  return { photoUrl: `/photos/${filename}`, destinationPath };
}

function cleanupOrphanedPendingPhotos(pendingPhotosDir, activePhotoUrls) {
  if (!fs.existsSync(pendingPhotosDir)) return;
  const activeNames = new Set(
    activePhotoUrls
      .map((photoUrl) => pendingPhotoPath(pendingPhotosDir, photoUrl))
      .filter(Boolean)
      .map((photoPath) => path.basename(photoPath))
  );
  for (const filename of fs.readdirSync(pendingPhotosDir)) {
    if (!PENDING_PHOTO_PATTERN.test(`/data/photo/${filename}`)) continue;
    if (!activeNames.has(filename)) fs.unlinkSync(path.join(pendingPhotosDir, filename));
  }
}

function deleteManagedPhoto(photosDir, photoUrl) {
  if (!photoUrl || !String(photoUrl).startsWith('/photos/')) return;
  const filename = path.basename(String(photoUrl).split('?')[0]);
  if (!/^edited_\d+_v\d+\.(?:jpg|jpeg|png|webp)$/i.test(filename)) return;
  const photoPath = path.join(photosDir, filename);
  if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
}

function writeEditsBackup(db, editsFile) {
  const rows = db.prepare('SELECT no, data FROM edits ORDER BY no').all();
  const backup = {};
  for (const row of rows) {
    try {
      backup[row.no] = JSON.parse(row.data);
    } catch (error) {}
  }
  fs.writeFileSync(editsFile, JSON.stringify(backup, null, 2), 'utf8');
}

function writePeopleBackup(db, peopleFile) {
  const people = db.prepare('SELECT * FROM people ORDER BY no ASC').all();
  fs.writeFileSync(peopleFile, JSON.stringify(people, null, 2), 'utf8');
}

module.exports = {
  cleanupOrphanedPendingPhotos,
  deleteManagedPhoto,
  deletePendingPhoto,
  pendingPhotoPath,
  promotePendingPhoto,
  writeEditsBackup,
  writePendingPhoto,
  writePeopleBackup
};
