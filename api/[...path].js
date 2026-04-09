/**
 * Vercel serverless: proxy /api/* → BACKEND_ORIGIN/api/*
 *
 * In Vercel → Settings → Environment Variables, set:
 *   BACKEND_ORIGIN = https://your-fastapi-host.example.com
 * (origin only: no trailing slash, no /api suffix)
 *
 * Deploy with Vercel project root = repository root, or use frontend/api/[...path].js
 * if the Vercel "Root Directory" is set to `frontend`.
 */

module.exports = async (req, res) => {
  const backend = (process.env.BACKEND_ORIGIN || '').replace(/\/$/, '');
  if (!backend) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(503).json({
      error:
        'Vercel proxy: set BACKEND_ORIGIN to your deployed FastAPI origin (e.g. https://xxx.up.railway.app).',
      detail: null,
    });
  }

  try {
    let search = '';
    let pathname = req.url || '/';
    const q = pathname.indexOf('?');
    if (q >= 0) {
      search = pathname.slice(q);
      pathname = pathname.slice(0, q);
    }
    if (pathname.includes('://')) {
      pathname = new URL(pathname).pathname;
    }

    // Vercel catch-all: segments often appear as req.query.path (string or array).
    const qp = req.query && req.query.path;
    let rel = '';
    if (qp !== undefined && qp !== '') {
      rel = Array.isArray(qp) ? qp.join('/') : String(qp);
    } else {
      rel = pathname.replace(/^\/api\/?/, '');
    }
    rel = rel.replace(/^\/+/, '');
    const targetUrl = `${backend}/api/${rel}${search}`;

    const skip = new Set([
      'connection',
      'content-length',
      'host',
      'transfer-encoding',
      'keep-alive',
      'proxy-connection',
      'upgrade',
    ]);
    const outHeaders = {};
    for (const [key, val] of Object.entries(req.headers)) {
      if (val == null) continue;
      if (skip.has(key.toLowerCase())) continue;
      outHeaders[key] = Array.isArray(val) ? val.join(', ') : val;
    }

    let body;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }

    const fr = await fetch(targetUrl, {
      method: req.method,
      headers: outHeaders,
      body: body && body.length ? body : undefined,
    });

    const buf = Buffer.from(await fr.arrayBuffer());
    const ct = fr.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    fr.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (lk.startsWith('access-control-')) return;
      if (['transfer-encoding', 'connection', 'content-encoding'].includes(lk)) return;
      if (lk === 'content-type') return;
      try {
        res.setHeader(key, value);
      } catch {
        /* ignore invalid headers for Node response */
      }
    });

    return res.status(fr.status).send(buf);
  } catch (e) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(502).json({
      error: `Proxy error: ${e && e.message ? e.message : String(e)}`,
      detail: null,
    });
  }
};
