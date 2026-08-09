'use strict';

function createEditRequestGuard({
  maxActive = 20,
  maxRequests = 5,
  windowMs = 10 * 60 * 1000
} = {}) {
  const attempts = new Map();
  let active = 0;
  let lastSweep = Date.now();

  return function editRequestGuard(req, res, next) {
    if (req.method !== 'POST' || !/^\/api\/edit-requests\/\d+$/.test(req.path)) {
      return next();
    }

    const now = Date.now();
    if (now - lastSweep >= windowMs) {
      for (const [attemptKey, times] of attempts) {
        if (!times.some((time) => now - time < windowMs)) attempts.delete(attemptKey);
      }
      lastSweep = now;
    }
    const key = `${req.ip}:${req.path}`;
    const recent = (attempts.get(key) || []).filter((time) => now - time < windowMs);
    if (recent.length >= maxRequests) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Too many edit requests. Try again later.' });
    }
    if (active >= maxActive) {
      res.set('Retry-After', '2');
      return res.status(503).json({ error: 'Too many uploads in progress. Try again shortly.' });
    }

    recent.push(now);
    attempts.set(key, recent);
    active += 1;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      active -= 1;
    };
    res.once('finish', release);
    res.once('close', release);
    return next();
  };
}

module.exports = { createEditRequestGuard };
