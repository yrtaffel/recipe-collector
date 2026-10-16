// Recipe Collector server: zero runtime dependencies, JSON-file storage.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(IMG_DIR, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
};
const IMG_EXT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
};

// ---------- storage ----------
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function loadDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    const names = ['Breakfast', 'Breads', 'Main Dishes', 'Side Dishes', 'Soups', 'Salads', 'Desserts'];
    return { categories: names.map((name) => ({ id: uid(), name })), recipes: [] };
  }
}
let db = loadDb();
function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
save();

// ---------- helpers ----------
function send(res, status, body, headers = {}) {
  const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isObj ? 'application/json' : 'text/plain', ...headers });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJson = async (req, limit = 25e6) => {
  const buf = await readBody(req, limit);
  try { return JSON.parse(buf.toString() || '{}'); }
  catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
};

function saveImage(buf, contentType) {
  const ext = IMG_EXT[(contentType || '').split(';')[0].trim().toLowerCase()];
  if (!ext) throw Object.assign(new Error('Unsupported image type'), { status: 415 });
  const name = uid() + ext;
  fs.writeFileSync(path.join(IMG_DIR, name), buf);
  return '/images/' + name;
}

// Download remote images in clipped HTML so recipes keep working offline.
async function localizeImages(html) {
  const re = /(<img\b[^>]*?\bsrc=)(["'])(https?:\/\/[^"']+)\2/gi;
  const urls = [...new Set([...html.matchAll(re)].map((m) => m[3]))].slice(0, 30);
  const map = {};
  await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 RecipeCollector' } });
      if (!r.ok) return;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 15e6) return;
      map[u] = saveImage(buf, r.headers.get('content-type'));
    } catch { /* keep remote URL on failure */ }
  }));
  return html.replace(re, (all, pre, q, u) => (map[u] ? `${pre}${q}${map[u]}${q}` : all));
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in o).map((k) => [k, o[k]]));
const str = (v, max) => String(v ?? '').slice(0, max);

function cleanRecipe(input) {
  const out = {};
  if ('title' in input) out.title = str(input.title, 300).trim() || 'Untitled recipe';
  if ('html' in input) out.html = str(input.html, 2e6);
  if ('source' in input) out.source = str(input.source, 300);
  if ('url' in input) out.url = str(input.url, 2000);
  if ('categoryId' in input) {
    out.categoryId = db.categories.some((c) => c.id === input.categoryId) ? input.categoryId : null;
  }
  return out;
}

// ---------- API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [coll, id] = parts;
  const m = req.method;

  if (coll === 'state' && m === 'GET') return send(res, 200, db);

  if (coll === 'categories') {
    if (m === 'POST') {
      const b = await readJson(req);
      const cat = { id: uid(), name: str(b.name, 100).trim() || 'New category' };
      db.categories.push(cat); save();
      return send(res, 201, cat);
    }
    const cat = db.categories.find((c) => c.id === id);
    if (!cat) return send(res, 404, { error: 'Not found' });
    if (m === 'PUT') {
      const b = await readJson(req);
      if ('name' in b) cat.name = str(b.name, 100).trim() || cat.name;
      save(); return send(res, 200, cat);
    }
    if (m === 'DELETE') {
      db.categories = db.categories.filter((c) => c !== cat);
      db.recipes.forEach((r) => { if (r.categoryId === id) r.categoryId = null; });
      save(); return send(res, 200, { ok: true });
    }
  }

  // Reorder categories: PUT /api/category-order  { ids: [...] }
  if (coll === 'category-order' && m === 'PUT') {
    const { ids = [] } = await readJson(req);
    const byId = new Map(db.categories.map((c) => [c.id, c]));
    const ordered = ids.map((i) => byId.get(i)).filter(Boolean);
    const rest = db.categories.filter((c) => !ids.includes(c.id));
    db.categories = [...ordered, ...rest]; save();
    return send(res, 200, { ok: true });
  }

  if (coll === 'recipes') {
    if (m === 'POST') {
      const b = await readJson(req);
      const r = { id: uid(), title: 'Untitled recipe', html: '', source: '', url: '', categoryId: null,
        createdAt: now(), updatedAt: now(), ...cleanRecipe(b) };
      db.recipes.push(r); save();
      return send(res, 201, r);
    }
    const r = db.recipes.find((x) => x.id === id);
    if (!r) return send(res, 404, { error: 'Not found' });
    if (m === 'PUT') {
      Object.assign(r, cleanRecipe(await readJson(req)), { updatedAt: now() });
      save(); return send(res, 200, r);
    }
    if (m === 'DELETE') {
      db.recipes = db.recipes.filter((x) => x !== r); save();
      return send(res, 200, { ok: true });
    }
  }

  // Raw image upload: POST /api/images  (body = image bytes)
  if (coll === 'images' && m === 'POST') {
    const buf = await readBody(req, 40e6);
    return send(res, 201, { url: saveImage(buf, req.headers['content-type']) });
  }

  // Chrome extension: POST /api/clip { title, url, html, categoryId }
  if (coll === 'clip' && m === 'POST') {
    const b = await readJson(req, 40e6);
    const html = await localizeImages(str(b.html, 2e6));
    const r = { id: uid(), createdAt: now(), updatedAt: now(), source: '',
      ...cleanRecipe({ title: b.title, url: b.url, categoryId: b.categoryId }), html };
    if (!r.url) r.url = '';
    db.recipes.push(r); save();
    return send(res, 201, r);
  }

  send(res, 404, { error: 'Not found' });
}

// ---------- static ----------
function serveFile(res, base, rel) {
  const file = path.join(base, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'Not found');
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    // Clipped HTML is untrusted: forbid inline/remote script no matter what.
    'Content-Security-Policy': "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'none'",
  });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) {
      // No CORS headers: other websites can't read or write recipes. The
      // Chrome extension bypasses CORS via its host_permissions.
      const origin = req.headers.origin;
      if (origin && !/^(chrome-extension:\/\/|https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$)/.test(origin)) {
        return send(res, 403, { error: 'Forbidden origin' });
      }
      return await api(req, res, url);
    }
    if (url.pathname.startsWith('/images/')) return serveFile(res, IMG_DIR, url.pathname.slice(8));
    return serveFile(res, PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
  } catch (e) {
    send(res, e.status || 500, { error: e.message || 'Server error' });
  }
});

server.listen(PORT, HOST, () => console.log(`Recipe Collector running at http://localhost:${PORT}`));
