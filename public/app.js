// Recipe Collector front end (vanilla JS, no build step).
const $ = (s, el = document) => el.querySelector(s);
const UNSORTED = '__unsorted__';
let state = { categories: [], recipes: [] };
let view = { cat: 'all', q: '' };

// ---------- API ----------
async function api(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
async function refresh() {
  state = await api('GET', '/api/state');
  render();
}
async function uploadImage(blob) {
  const r = await fetch('/api/images', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
  if (!r.ok) throw new Error('Upload failed');
  return (await r.json()).url;
}

// ---------- sanitizing untrusted HTML (clips, pastes) ----------
const ALLOWED = new Set('a b i u em strong s strike p br hr div span ul ol li h1 h2 h3 h4 h5 h6 blockquote pre code img table thead tbody tfoot tr td th caption sub sup figure figcaption small'.split(' '));
const DROP = new Set('script style iframe object embed form input button select textarea link meta noscript svg canvas video audio'.split(' '));
function safeUrl(v, allowData) {
  v = (v || '').trim();
  if (/^(https?:|mailto:|\/images\/)/i.test(v)) return v;
  if (allowData && /^data:image\/(png|jpe?g|gif|webp);/i.test(v)) return v;
  return null;
}
function sanitize(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  (function walk(node) {
    for (const el of [...node.children]) {
      const tag = el.tagName.toLowerCase();
      if (DROP.has(tag)) { el.remove(); continue; }
      walk(el);
      if (!ALLOWED.has(tag)) { el.replaceWith(...el.childNodes); continue; }
      for (const a of [...el.attributes]) {
        const n = a.name.toLowerCase();
        const ok = (tag === 'a' && n === 'href') || (tag === 'img' && (n === 'src' || n === 'alt')) ||
          n === 'title' || n === 'colspan' || n === 'rowspan';
        if (!ok) el.removeAttribute(a.name);
      }
      if (tag === 'a') {
        const h = safeUrl(el.getAttribute('href'));
        if (h) { el.setAttribute('href', h); el.target = '_blank'; el.rel = 'noopener noreferrer'; } else el.removeAttribute('href');
      }
      if (tag === 'img') {
        const s = safeUrl(el.getAttribute('src'), true);
        if (s) el.setAttribute('src', s); else el.remove();
      }
    }
  })(doc.body);
  return doc.body.innerHTML;
}
const textOf = (html) => new DOMParser().parseFromString(html || '', 'text/html').body.textContent || '';
const firstImg = (html) => (/<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(html || '') || [])[1];
const catName = (id) => state.categories.find((c) => c.id === id)?.name || 'Unsorted';

// ---------- sidebar ----------
function render() {
  const nav = $('#cats');
  nav.innerHTML = '';
  const unsortedCount = state.recipes.filter((r) => !r.categoryId).length;
  const items = [
    { id: 'all', name: 'All recipes', count: state.recipes.length, fixed: true },
    ...state.categories.map((c) => ({ id: c.id, name: c.name, count: state.recipes.filter((r) => r.categoryId === c.id).length })),
    { id: UNSORTED, name: 'Unsorted', count: unsortedCount, fixed: true, dropNull: true },
  ];
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'cat' + (view.cat === it.id ? ' active' : '');
    el.innerHTML = '<span class="name"></span><span class="count"></span><span class="tools"><button title="Rename">✎</button><button title="Delete">×</button></span>';
    $('.name', el).textContent = it.name;
    $('.count', el).textContent = it.count;
    el.onclick = () => { view.cat = it.id; render(); };
    if (it.fixed) $('.tools', el).remove();
    else {
      const [ren, del] = $('.tools', el).children;
      ren.onclick = async (e) => {
        e.stopPropagation();
        const n = prompt('Rename category', it.name);
        if (n && n.trim()) { await api('PUT', '/api/categories/' + it.id, { name: n }); refresh(); }
      };
      del.onclick = async (e) => {
        e.stopPropagation();
        if (confirm(`Delete "${it.name}"? Its recipes move to Unsorted.`)) {
          if (view.cat === it.id) view.cat = 'all';
          await api('DELETE', '/api/categories/' + it.id); refresh();
        }
      };
      // reorder categories by dragging
      el.draggable = true;
      el.ondragstart = (e) => e.dataTransfer.setData('text/category', it.id);
    }
    // drop target for recipes (and for category reordering)
    if (it.id !== 'all') {
      el.ondragover = (e) => { e.preventDefault(); el.classList.add('dragover'); };
      el.ondragleave = () => el.classList.remove('dragover');
      el.ondrop = async (e) => {
        e.preventDefault(); el.classList.remove('dragover');
        const rid = e.dataTransfer.getData('text/recipe');
        const cid = e.dataTransfer.getData('text/category');
        if (rid) {
          await api('PUT', '/api/recipes/' + rid, { categoryId: it.dropNull ? null : it.id });
          refresh();
        } else if (cid && !it.fixed && cid !== it.id) {
          const ids = state.categories.map((c) => c.id).filter((i) => i !== cid);
          ids.splice(ids.indexOf(it.id), 0, cid);
          await api('PUT', '/api/category-order', { ids }); refresh();
        }
      };
    }
    nav.append(el);
  }
  renderGrid();
}

function renderGrid() {
  const q = view.q.trim().toLowerCase();
  let list = state.recipes.filter((r) =>
    view.cat === 'all' ? true : view.cat === UNSORTED ? !r.categoryId : r.categoryId === view.cat);
  if (q) list = list.filter((r) => (r.title + ' ' + r.source + ' ' + textOf(r.html)).toLowerCase().includes(q));
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  $('#heading').textContent = view.cat === 'all' ? 'All recipes' : view.cat === UNSORTED ? 'Unsorted' : catName(view.cat);
  const grid = $('#grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = '<div class="empty">No recipes here yet. Clip one with the Chrome extension, add one by hand, or import photos.</div>';
    return;
  }
  for (const r of list) {
    const el = document.createElement('div');
    el.className = 'card';
    el.draggable = true;
    el.innerHTML = '<div class="thumb">🍽️</div><div class="info"><div class="t"></div><div class="s"></div></div>';
    $('.t', el).textContent = r.title;
    $('.s', el).textContent = [r.source, view.cat === 'all' ? catName(r.categoryId) : ''].filter(Boolean).join(' · ');
    const img = firstImg(r.html);
    if (img && safeUrl(img, true)) { const t = $('.thumb', el); t.textContent = ''; t.style.backgroundImage = `url("${encodeURI(img)}")`; }
    el.ondragstart = (e) => { e.dataTransfer.setData('text/recipe', r.id); el.classList.add('dragging'); };
    el.ondragend = () => el.classList.remove('dragging');
    el.onclick = () => openRecipe(r, false);
    grid.append(el);
  }
}

// ---------- recipe viewer / editor ----------
const viewer = $('#viewer');
function catOptions(sel) {
  const s = document.createElement('select');
  s.append(new Option('Unsorted', ''));
  state.categories.forEach((c) => s.append(new Option(c.name, c.id)));
  s.value = sel || '';
  return s;
}

function openRecipe(r, edit) {
  viewer.innerHTML = '';
  edit ? renderEditor(r) : renderView(r);
  if (!viewer.open) viewer.showModal();
}

function renderView(r) {
  const h = document.createElement('div');
  h.innerHTML = '<h2></h2><div class="meta"></div><div class="body"></div><div class="row"><button data-a="edit" class="primary">Edit</button><label style="margin:0">Move to <span id="mv"></span></label><span class="spacer"></span><button data-a="del">Delete</button><button data-a="close">Close</button></div>';
  $('h2', h).textContent = r.title;
  const meta = $('.meta', h);
  meta.append(catName(r.categoryId));
  if (r.source) meta.append(' · 📖 ' + r.source);
  if (safeUrl(r.url)) {
    const a = document.createElement('a');
    a.href = r.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = ' · 🔗 ' + (() => { try { return new URL(r.url).hostname; } catch { return 'source'; } })();
    meta.append(a);
  }
  $('.body', h).innerHTML = sanitize(r.html) || '<span class="hint">(empty)</span>';
  const sel = catOptions(r.categoryId);
  sel.onchange = async () => { await api('PUT', '/api/recipes/' + r.id, { categoryId: sel.value || null }); await refresh(); r.categoryId = sel.value || null; openRecipe(r, false); };
  $('#mv', h).append(sel);
  h.onclick = async (e) => {
    const a = e.target.dataset?.a;
    if (a === 'close') viewer.close();
    if (a === 'edit') openRecipe(r, true);
    if (a === 'del' && confirm('Delete this recipe?')) { await api('DELETE', '/api/recipes/' + r.id); viewer.close(); refresh(); }
  };
  viewer.append(h);
}

function renderEditor(r) {
  const h = document.createElement('div');
  h.innerHTML = `<h2>${r.id ? 'Edit recipe' : 'New recipe'}</h2>
    <label>Title <input id="eTitle"></label>
    <label>Category <span id="eCat"></span></label>
    <label>Cookbook / source name <input id="eSource" placeholder="optional, e.g. Marble Spoon"></label>
    <label>Link <input id="eUrl" placeholder="optional, https://…"></label>
    <div class="toolbar">
      <button data-c="bold"><b>B</b></button><button data-c="italic"><i>I</i></button>
      <button data-c="insertUnorderedList">• List</button><button data-c="insertOrderedList">1. List</button>
      <button data-c="h">Heading</button><button data-c="link">Link</button>
      <label class="link" style="margin:0;align-self:center">+ Photo<input id="ePhoto" type="file" accept="image/*" multiple hidden></label>
    </div>
    <div class="body" id="eBody" contenteditable="true"></div>
    <p class="hint">Tip: paste text, links or screenshots straight in. Plain text works fine.</p>
    <div class="row"><button class="primary" data-a="save">Save</button><button data-a="cancel">Cancel</button></div>`;
  $('#eTitle', h).value = r.title || '';
  $('#eSource', h).value = r.source || '';
  $('#eUrl', h).value = r.url || '';
  const sel = catOptions(r.categoryId); $('#eCat', h).append(sel);
  const body = $('#eBody', h);
  body.innerHTML = sanitize(r.html || '');

  body.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    e.preventDefault();
    if (files.length) { for (const f of files) insertImage(await uploadImage(f)); return; }
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, sanitize(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  });
  const insertImage = (url) => { body.focus(); document.execCommand('insertHTML', false, `<img src="${url}"><br>`); };
  $('#ePhoto', h).onchange = async (e) => {
    for (const f of e.target.files) insertImage(await uploadImage(await shrink(f)));
    e.target.value = '';
  };
  h.onclick = async (e) => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    const a = e.target.dataset?.a;
    if (c) {
      body.focus();
      if (c === 'h') document.execCommand('formatBlock', false, 'h3');
      else if (c === 'link') { const u = prompt('Link URL (https://…)'); if (u && safeUrl(u)) document.execCommand('createLink', false, u); }
      else document.execCommand(c);
    }
    if (a === 'cancel') r.id ? openRecipe(r, false) : viewer.close();
    if (a === 'save') {
      const data = {
        title: $('#eTitle', h).value, categoryId: sel.value || null, source: $('#eSource', h).value,
        url: $('#eUrl', h).value, html: sanitize(body.innerHTML),
      };
      const saved = r.id ? await api('PUT', '/api/recipes/' + r.id, data) : await api('POST', '/api/recipes', data);
      await refresh();
      openRecipe(saved, false);
    }
  };
  viewer.append(h);
}

$('#newRecipe').onclick = () => openRecipe({ categoryId: ['all', UNSORTED].includes(view.cat) ? null : view.cat }, true);
$('#addCat').onclick = async () => {
  const n = prompt('New category name');
  if (n && n.trim()) { await api('POST', '/api/categories', { name: n }); refresh(); }
};
$('#search').oninput = (e) => { view.q = e.target.value; renderGrid(); };

// ---------- photo import ----------
const importer = $('#importer');
const IMG_RE = /\.(jpe?g|png|webp|gif|heic)$/i;
const log = (m) => { $('#importLog').textContent = m; };

// Downscale big phone photos (saves disk, keeps text readable). Falls back to the original.
async function shrink(file, max = 2000) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.86));
  } catch {
    if (/^image\/(png|jpeg|gif|webp)$/.test(file.type)) return file;
    throw new Error('Unsupported image (HEIC?). Export as JPEG first.');
  }
}

// Collect [{file, album}] from files / folders / zips.
async function gather(fileList, entries) {
  const out = [];
  const addFile = (file, path) => {
    const parts = path.split('/').filter(Boolean);
    out.push({ file, album: parts.length > 1 ? parts[parts.length - 2] : '' });
  };
  async function walk(entry, prefix) {
    if (entry.isFile) {
      const f = await new Promise((res) => entry.file(res));
      if (IMG_RE.test(f.name)) addFile(f, prefix + f.name); else if (/\.zip$/i.test(f.name)) await addZip(f);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res) => reader.readEntries(res));
        for (const e of batch) await walk(e, prefix + entry.name + '/');
      } while (batch.length);
    }
  }
  async function addZip(zipFile) {
    log('Reading ' + zipFile.name + '…');
    const u8 = new Uint8Array(await zipFile.arrayBuffer());
    const files = await new Promise((res, rej) =>
      fflate.unzip(u8, { filter: (f) => IMG_RE.test(f.name) && !f.name.includes('__MACOSX') }, (err, d) => (err ? rej(err) : res(d))));
    for (const [name, data] of Object.entries(files)) {
      const ext = name.split('.').pop().toLowerCase();
      const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic' }[ext];
      addFile(new File([data], name.split('/').pop(), { type }), name);
    }
  }
  if (entries) for (const e of entries) await walk(e, '');
  else for (const f of fileList) {
    if (/\.zip$/i.test(f.name)) await addZip(f);
    else if (IMG_RE.test(f.name) || f.type.startsWith('image/')) addFile(f, f.webkitRelativePath || f.name);
  }
  return out;
}

async function runImport(items) {
  if (!items.length) { log('No images found.'); return; }
  const bar = $('#progress');
  bar.hidden = false; bar.max = items.length; bar.value = 0;
  const fallbackSource = $('#importSource').value.trim();
  const categoryId = $('#importCat').value || null;
  const counters = {};
  let done = 0, failed = 0;
  items.sort((a, b) => (a.album + a.file.name).localeCompare(b.album + b.file.name, undefined, { numeric: true }));
  for (const { file, album } of items) {
    const source = album && album !== 'Google Photos' ? album : fallbackSource;
    counters[source] = (counters[source] || 0) + 1;
    try {
      const url = await uploadImage(await shrink(file));
      const title = (source ? source + ' – ' : 'Photo ') + counters[source];
      await api('POST', '/api/recipes', { title, source, categoryId, html: `<p><img src="${url}"></p>` });
      done++;
    } catch (e) { failed++; }
    bar.value = done + failed;
    log(`Imported ${done} of ${items.length}${failed ? ` (${failed} failed)` : ''}…`);
  }
  log(`Done: ${done} imported${failed ? `, ${failed} failed (HEIC or unreadable)` : ''}. Close this and drag them into categories.`);
  refresh();
}

$('#openImport').onclick = () => {
  const s = $('#importCat');
  s.innerHTML = '';
  s.append(new Option('Unsorted (I\'ll sort them later)', ''));
  state.categories.forEach((c) => s.append(new Option(c.name, c.id)));
  $('#progress').hidden = true; log('');
  importer.showModal();
};
$('#closeImport').onclick = () => importer.close();
for (const id of ['files', 'folder']) {
  $('#' + id).onchange = async (e) => { const items = await gather([...e.target.files]); e.target.value = ''; runImport(items); };
}
const drop = $('#drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = async (e) => {
  e.preventDefault(); drop.classList.remove('over');
  const entries = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  runImport(await gather([...e.dataTransfer.files], entries.length ? entries : null));
};

refresh();
