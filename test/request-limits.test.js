'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createEditRequestGuard } = require('../lib/request-limits');

function response() {
  const res = new EventEmitter();
  res.headers = {};
  res.set = (name, value) => { res.headers[name] = value; };
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

test('edit request guard rate limits by IP and person path', () => {
  const guard = createEditRequestGuard({ maxRequests: 2, maxActive: 10, windowMs: 60000 });
  const request = { method: 'POST', path: '/api/edit-requests/1', ip: '203.0.113.1' };

  for (let index = 0; index < 2; index += 1) {
    const res = response();
    let called = false;
    guard(request, res, () => { called = true; });
    assert.equal(called, true);
    res.emit('finish');
  }

  const limited = response();
  guard(request, limited, () => assert.fail('rate-limited request called next'));
  assert.equal(limited.statusCode, 429);

  const anotherPerson = response();
  let called = false;
  guard({ ...request, path: '/api/edit-requests/2' }, anotherPerson, () => { called = true; });
  assert.equal(called, true);
  anotherPerson.emit('finish');
});

test('edit request guard caps active uploads', () => {
  const guard = createEditRequestGuard({ maxRequests: 10, maxActive: 1 });
  const request = { method: 'POST', path: '/api/edit-requests/1', ip: '203.0.113.2' };
  const active = response();
  guard(request, active, () => {});

  const limited = response();
  guard(request, limited, () => assert.fail('concurrency-limited request called next'));
  assert.equal(limited.statusCode, 503);
  active.emit('close');
});
