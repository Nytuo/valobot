// HTTP hardening helpers: security headers, rate limiting and same-origin (CSRF) guard.

function securityHeaders({ secure = false } = {}) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://cdn.discordapp.com",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');

  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    if (secure) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}

// Fixed-window in-memory limiter keyed by client IP (trust proxy must be configured)
function rateLimit({ windowMs, max, message = 'Too many requests, slow down.' }) {
  const hits = new Map();
  const cleaner = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  cleaner.unref();

  return (req, res, next) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

function isSameOrigin(origin, host, allowedOrigin) {
  if (!origin) return false;
  if (origin === allowedOrigin) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

// Reject state-changing requests that come from another origin
function sameOriginGuard(allowedOrigin) {
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !isSameOrigin(origin, req.headers.host, allowedOrigin)) {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
    if (!origin && req.headers['sec-fetch-site'] === 'cross-site') {
      return res.status(403).json({ error: 'Cross-origin request blocked.' });
    }
    next();
  };
}

module.exports = { securityHeaders, rateLimit, sameOriginGuard, isSameOrigin };
