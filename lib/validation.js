'use strict';

const EDITABLE_FIELDS = Object.freeze([
  'rank', 'name', 'nick', 'pos', 'committeeRole', 'phone', 'unit', 'batch', 'birth', 'age', 't'
]);

const FIELD_LIMITS = Object.freeze({
  rank: 30,
  name: 120,
  nick: 60,
  pos: 240,
  committeeRole: 240,
  phone: 20,
  unit: 120,
  batch: 120,
  birth: 60,
  age: 10
});

const MAX_IMAGE_BYTES = 500 * 1024;
const DATA_IMAGE_PATTERN = /^data:image\/(jpeg|png|webp);base64,([a-z0-9+/=\s]+)$/i;

function validationError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parsePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw validationError(`Invalid ${label}`);
  }
  return number;
}

function parseVersion(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw validationError('Invalid expected version');
  }
  return number;
}

function sanitizeText(value, field, required = false) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw validationError(`Invalid ${field}`);
  }
  const text = String(value).trim();
  const limit = FIELD_LIMITS[field];
  if (limit && text.length > limit) {
    throw validationError(`${field} is too long`);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw validationError(`${field} contains control characters`);
  }
  if (required && !text) throw validationError(`${field} is required`);
  return text;
}

function validatePhone(phone) {
  if (phone && !/^[0-9+().\-\s]{3,20}$/.test(phone)) {
    throw validationError('Invalid phone');
  }
}

function validateAge(age) {
  if (age && (!/^\d{1,3}$/.test(age) || Number(age) > 130)) {
    throw validationError('Invalid age');
  }
}

function decodeDataImage(value) {
  const match = DATA_IMAGE_PATTERN.exec(String(value || ''));
  if (!match) throw validationError('Invalid image format');

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw validationError('Image must be between 1 byte and 500 KB');
  }

  const mime = match[1].toLowerCase();
  const signatures = {
    jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff
      && buffer[buffer.length - 1] === 0xd9,
    png: buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    webp: buffer.subarray(0, 4).toString() === 'RIFF'
      && buffer.subarray(8, 12).toString() === 'WEBP'
  };
  if (!signatures[mime]) throw validationError('Image content does not match its type');

  return { buffer, extension: mime === 'jpeg' ? 'jpg' : mime };
}

function sanitizePhoto(value) {
  const photo = String(value || '').trim();
  if (!photo) return '';
  if (photo.startsWith('data:image/')) {
    decodeDataImage(photo);
    return photo;
  }
  if (!/^\/photos\/[a-z0-9_.-]+\.(?:jpg|jpeg|png|webp)$/i.test(photo)) {
    throw validationError('Invalid photo path');
  }
  return photo;
}

function sanitizeEditData(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Invalid edit data');
  }
  const unknownFields = Object.keys(input).filter((field) => !EDITABLE_FIELDS.includes(field));
  if (unknownFields.length) throw validationError(`Unsupported fields: ${unknownFields.join(', ')}`);

  const data = {};
  for (const field of EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue;
    data[field] = field === 't' ? sanitizePhoto(input[field]) : sanitizeText(input[field], field);
  }
  validatePhone(data.phone);
  validateAge(data.age);
  return data;
}

function sanitizeNewPerson(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('Invalid person data');
  }
  const person = {};
  for (const field of EDITABLE_FIELDS.filter((name) => name !== 'committeeRole')) {
    if (field === 't') person.t = sanitizePhoto(input.t);
    else person[field] = sanitizeText(input[field], field, field === 'name');
  }
  validatePhone(person.phone);
  validateAge(person.age);
  return person;
}

module.exports = {
  decodeDataImage,
  parsePositiveInteger,
  parseVersion,
  sanitizeEditData,
  sanitizeNewPerson,
  validationError
};
