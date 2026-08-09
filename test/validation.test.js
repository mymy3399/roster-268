'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  decodeDataImage,
  parsePositiveInteger,
  parseVersion,
  sanitizeEditData,
  sanitizeNewPerson
} = require('../lib/validation');

test('sanitizeEditData accepts known fields and trims text', () => {
  assert.deepEqual(
    sanitizeEditData({
      name: '  สมชาย ใจดี  ',
      committeeRole: '  เหรัญญิก  ',
      phone: '081-234-5678',
      age: '35'
    }),
    {
      name: 'สมชาย ใจดี',
      committeeRole: 'เหรัญญิก',
      phone: '081-234-5678',
      age: '35'
    }
  );
});

test('sanitizeEditData rejects unknown and dangerous fields', () => {
  assert.throws(
    () => sanitizeEditData({ name: 'สมชาย', isAdmin: true }),
    /Unsupported fields/
  );
  assert.throws(
    () => sanitizeEditData({ phone: 'javascript:alert(1)' }),
    /Invalid phone/
  );
});

test('sanitizeNewPerson requires a name and validates age', () => {
  assert.throws(() => sanitizeNewPerson({ name: '' }), /name is required/);
  assert.throws(() => sanitizeNewPerson({ name: 'สมชาย', age: '999' }), /Invalid age/);
});

test('integer parsers reject invalid identifiers and versions', () => {
  assert.equal(parsePositiveInteger('12', 'person number'), 12);
  assert.equal(parseVersion(0), 0);
  assert.throws(() => parsePositiveInteger('../1', 'person number'), /Invalid person number/);
  assert.throws(() => parseVersion(-1), /Invalid expected version/);
});

test('decodeDataImage verifies declared image signatures', () => {
  const pngHeader = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).toString('base64');
  const decoded = decodeDataImage(`data:image/png;base64,${pngHeader}`);
  assert.equal(decoded.extension, 'png');
  assert.deepEqual(decoded.buffer, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.throws(
    () => decodeDataImage(`data:image/jpeg;base64,${pngHeader}`),
    /does not match/
  );
});

test('decodeDataImage caps decoded photos at 500 KB', () => {
  const accepted = Buffer.alloc(500 * 1024, 0x61);
  accepted[0] = 0xff;
  accepted[1] = 0xd8;
  accepted[accepted.length - 2] = 0xff;
  accepted[accepted.length - 1] = 0xd9;
  assert.equal(
    decodeDataImage(`data:image/jpeg;base64,${accepted.toString('base64')}`).buffer.length,
    500 * 1024
  );

  const rejected = Buffer.concat([accepted, Buffer.from([0xff, 0xd9])]);
  assert.throws(
    () => decodeDataImage(`data:image/jpeg;base64,${rejected.toString('base64')}`),
    /500 KB/
  );
});
