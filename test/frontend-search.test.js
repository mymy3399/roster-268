'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

test('directory search matches a person by nickname', async () => {
  const moduleUrl = pathToFileURL(
    path.join(__dirname, '..', 'public', 'js', 'search.mjs')
  ).href;
  let matches;

  try {
    ({ matches } = await import(moduleUrl));
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  }

  assert.equal(typeof matches, 'function', 'search behavior module must exist');
  assert.equal(matches({
    no: 27,
    name: 'สมชาย ใจดี',
    nick: 'หมู',
    pos: 'สารวัตร',
    committeeRole: ''
  }, 'หมู'), true);
});
