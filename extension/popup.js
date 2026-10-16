// Where your Recipe Collector server runs. Change if you use another port/host.
const APP = 'http://localhost:3000';
const $ = (s) => document.querySelector(s);
const msg = (t, cls = '') => { $('#msg').textContent = t; $('#msg').className = cls; };

// Runs inside the web page. Returns { title, url, html }.
function grab(mode) {
  const abs = (root) => {
    root.querySelectorAll('script,style,iframe,noscript,form,button,input,svg,nav,footer').forEach((e) => e.remove());
    root.querySelectorAll('img').forEach((i) => {
      const src = i.currentSrc || i.src || i.dataset.src || '';
      if (!src || src.startsWith('data:')) { i.remove(); return; }
      i.setAttribute('src', new URL(src, location.href).href);
      ['srcset', 'sizes', 'loading', 'class', 'style'].forEach((a) => i.removeAttribute(a));
    });
    root.querySelectorAll('a[href]').forEach((a) => a.setAttribute('href', new URL(a.getAttribute('href'), location.href).href));
    return root.innerHTML;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const out = { title: document.title, url: location.href, html: '' };

  if (mode === 'selection') {
    const s = getSelection();
    if (!s || s.isCollapsed) return { error: 'Select the recipe text on the page first, then click again.' };
    const div = document.createElement('div');
    for (let i = 0; i < s.rangeCount; i++) div.append(s.getRangeAt(i).cloneContents());
    out.html = abs(div);
  } else if (mode === 'smart') {
    // Use schema.org Recipe data (most recipe sites include it).
    const find = (n) => Array.isArray(n) ? n.map(find).find(Boolean)
      : n && typeof n === 'object' ? ([].concat(n['@type'] || []).includes('Recipe') ? n : find(n['@graph'])) : null;
    let r = null;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { r = find(JSON.parse(s.textContent)); } catch {}
      if (r) break;
    }
    if (!r) return { error: 'No structured recipe found on this page. Try selecting the text instead.' };
    const list = (v) => [].concat(v || []);
    const steps = (v) => list(v).flatMap((x) => typeof x === 'string' ? [x]
      : x.itemListElement ? steps(x.itemListElement) : x.text ? [x.text] : []);
    const img = list(r.image).map((i) => i.url || i)[0];
    const meta = [r.recipeYield && 'Yield: ' + list(r.recipeYield).join(', '), r.totalTime && 'Time: ' + r.totalTime.replace('PT', '').toLowerCase()].filter(Boolean);
    out.title = r.name || out.title;
    out.html = (img ? `<p><img src="${esc(img)}"></p>` : '') +
      (meta.length ? `<p>${esc(meta.join(' · '))}</p>` : '') +
      '<h3>Ingredients</h3><ul>' + list(r.recipeIngredient).map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>' +
      '<h3>Instructions</h3><ol>' + steps(r.recipeInstructions).map((i) => `<li>${esc(i)}</li>`).join('') + '</ol>';
  } else {
    const main = document.querySelector('article, main') || document.body;
    out.html = abs(main.cloneNode(true));
  }
  return out;
}

async function init() {
  try {
    const st = await (await fetch(APP + '/api/state')).json();
    $('#cat').append(new Option('Unsorted', ''));
    st.categories.forEach((c) => $('#cat').append(new Option(c.name, c.id)));
  } catch {
    msg('Can\'t reach the app. Is it running? (npm start)', 'err');
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('#title').value = tab.title || '';
  let edited = false;
  $('#title').oninput = () => { edited = true; };

  for (const [id, mode] of [['sel', 'selection'], ['smart', 'smart'], ['page', 'page']]) {
    $('#' + id).onclick = async () => {
      msg('Clipping…');
      try {
        const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: grab, args: [mode] });
        if (result.error) return msg(result.error, 'err');
        const r = await fetch(APP + '/api/clip', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...result, title: (edited && $('#title').value) || (mode === 'smart' ? result.title : $('#title').value) || result.title, categoryId: $('#cat').value || null }),
        });
        if (!r.ok) throw new Error('Server said ' + r.status);
        msg('Saved to your cookbook ✓', 'ok');
      } catch (e) { msg('Failed: ' + e.message, 'err'); }
    };
  }
}
init();
