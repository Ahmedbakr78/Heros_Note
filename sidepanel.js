'use strict';
/* markClipper panel app — fast vanilla JS, offline, unlimited, free. */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const MC = window.MarkClipper;
  const LS_CLIPS = 'mcClips', LS_SET = 'mcSettings', LS_NOTES = 'mcNotes', LS_TODOS = 'mcTodos', LS_DAYS = 'mcDays';

  const DEFAULTS = {
    theme: 'dark', width: 'comfort', font: 14, mode: 'article',
    autoshow: true, autoclip: true,
    frontmatter: true, titleH1: true, sourceLine: true,
    keepImages: true, keepLinks: true, keepTables: true, keepCode: true,
    hiRes: true, skipIcons: true, skipData: true, includeBg: true, captions: true,
    minW: 80, shotFmt: 'png',
    tpl: '{date}-{slug}', filterStar: false
  };

  let S = { ...DEFAULTS };
  let clips = [], notes = {}, todos = [];
  let curId = null, view = 'preview', q = '', fType = '', fSort = 'new', tagFilter = '';
  // Photo lab state (fast, in-memory; clips persist galleries)
  let pageImages = [], selSrc = new Set(), imgQ = '', imgSort = 'size', hideIconsUI = false;
  let shotDataUrl = '', shotMeta = null, lbIndex = 0;

  /* ---------- tiny utils ---------- */
  const uid = () => 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function toast(msg, kind) {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.innerHTML = '<svg class="ic"><use href="#' + (kind === 'ok' ? 'i-check' : kind === 'err' ? 'i-x' : 'i-zap') + '"/></svg><span>' + esc(msg) + '</span>';
    $('#toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2600);
  }
  function progress(p) {
    const bar = $('#progress'), fill = $('#progressBar');
    if (p == null) { bar.hidden = true; fill.style.width = '0%'; return; }
    bar.hidden = false; fill.style.width = Math.round(p * 100) + '%';
    if (p >= 1) setTimeout(() => progress(null), 350);
  }
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /* ---------- storage ---------- */
  async function load() {
    try {
      const r = await chrome.storage.local.get([LS_CLIPS, LS_SET, LS_NOTES, LS_TODOS, LS_DAYS]);
      clips = Array.isArray(r[LS_CLIPS]) ? r[LS_CLIPS] : [];
      S = { ...DEFAULTS, ...(r[LS_SET] || {}) };
      notes = r[LS_NOTES] || {};
      todos = Array.isArray(r[LS_TODOS]) ? r[LS_TODOS] : [];
      // streak
      const today = new Date().toISOString().slice(0, 10);
      let days = Array.isArray(r[LS_DAYS]) ? r[LS_DAYS] : [];
      if (!days.includes(today)) { days.push(today); days = days.slice(-60); await chrome.storage.local.set({ [LS_DAYS]: days }); }
      S._days = days;
    } catch (e) { clips = []; }
  }
  async function saveClips() { try { await chrome.storage.local.set({ [LS_CLIPS]: clips.slice(0, 5000) }); } catch (e) {} }
  async function saveSet() { const c = { ...S }; delete c._days; try { await chrome.storage.local.set({ [LS_SET]: c }); } catch (e) {} }
  async function saveNotes() { try { await chrome.storage.local.set({ [LS_NOTES]: notes }); } catch (e) {} }
  async function saveTodos() { try { await chrome.storage.local.set({ [LS_TODOS]: todos }); } catch (e) {} }

  /* ---------- theme ---------- */
  function applyTheme() {
    let t = S.theme;
    if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    $('#setTheme').value = S.theme;
  }
  function applyReading() {
    const v = $('#viewPreview');
    v.style.maxWidth = S.width === 'narrow' ? '560px' : S.width === 'wide' ? 'none' : '760px';
    v.style.margin = S.width === 'wide' ? '0' : '0 auto';
    v.style.fontSize = S.font + 'px';
    $('#setFontV').textContent = S.font + 'px';
    $('#setFont').value = S.font;
  }

  /* ---------- tabs ---------- */
  function goTab(name) {
    $$('.side-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    $$('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
  }
  $$('.side-tab').forEach((b) => b.addEventListener('click', () => goTab(b.dataset.tab)));

  /* ---------- view seg ---------- */
  $$('#viewSeg button').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    $$('#viewSeg button').forEach((x) => x.classList.toggle('on', x === b));
    $('#viewPreview').hidden = view !== 'preview';
    $('#viewSource').hidden = view !== 'source';
    $('#viewMeta').hidden = view !== 'meta';
  }));

  /* ---------- CLIP CORE ---------- */
  function cannotInject(url) {
    return !url || /^(chrome|edge|about|chrome-extension|moz-extension|file):/i.test(url);
  }
  async function extractFromTab(tabId, mode) {
    await chrome.scripting.executeScript({ target: { tabId }, func: (m) => { window.__mcMode = m; }, args: [mode] });
    const res = await chrome.scripting.executeScript({ target: { tabId }, files: ['content-extract.js'] });
    return res && res[0] && res[0].result;
  }
  function optsFromSettings() {
    return {
      frontmatter: S.frontmatter, titleHeading: S.titleH1, sourceLine: S.sourceLine,
      stripImages: !S.keepImages, stripLinks: !S.keepLinks
    };
  }
  async function clip(mode, info) {
    info = info || {};
    progress(0.2);
    setBusy(true);
    try {
      let tab = null;
      try { const ts = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); tab = ts && ts[0]; } catch (e) {}
      const url = (info.pageUrl || (tab && tab.url) || '').trim();
      if (!tab || cannotInject(tab.url) && !info.pageUrl) {
        // fallback: bookmark from tab info only
        if (mode !== 'bookmark' && !cannotInject(url)) throw new Error('no-tab');
        saveBookmarkClip({ title: (tab && tab.title) || 'Bookmark', url: url || 'about:blank', site: hostOf(url) }, mode);
        return;
      }
      // special fast paths needing no injection
      if (mode === 'bookmark') {
        saveBookmarkClip({ title: tab.title || url, url: tab.url, site: hostOf(tab.url) }, mode);
        return;
      }
      if (mode === 'link' && info.linkUrl) {
        saveBookmarkClip({ title: info.linkUrl, url: info.linkUrl, site: hostOf(info.linkUrl) }, 'link');
        return;
      }
      if (mode === 'image' && info.srcUrl) {
        const title = info.alt || ('Image — ' + hostOf(info.pageUrl || (tab && tab.url) || ''));
        const m = { title, url: info.pageUrl || (tab && tab.url) || info.srcUrl, site: hostOf((tab && tab.url) || info.pageUrl || info.srcUrl) };
        const body = MC.imageMarkdown({ src: info.srcUrl, alt: title }, 0) + '\n\n[Open original](' + info.srcUrl + ')';
        upsertPageImage({ src: info.srcUrl, alt: title, w: 0, h: 0, kind: 'single' });
        finishClip(m, body, 'image');
        return;
      }
      if (mode === 'images' || mode === 'photos') {
        await grabPhotos(tab);
        return;
      }
      if (mode === 'screenshot' || mode === 'shot') {
        await takeScreenshot(tab);
        return;
      }
      let data = null;
      try { data = await extractFromTab(tab.id, mode === 'link' ? 'article' : mode); }
      catch (e) { data = null; }
      if (!data || !data.html) {
        // blocked page -> graceful bookmark
        saveBookmarkClip({ title: tab.title || url, url: tab.url, site: hostOf(tab.url) }, 'bookmark');
        toast('Page blocked scripts — saved bookmark instead', 'err');
        return;
      }
      const meta = {
        title: (data.meta && data.meta.title) || tab.title || 'Untitled',
        url: (data.meta && data.meta.url) || tab.url,
        site: (data.meta && data.meta.site) || hostOf(tab.url),
        author: (data.meta && data.meta.author) || '',
        description: (data.meta && data.meta.description) || '',
        date: Date.now(), dateISO: new Date().toISOString(),
        clipType: data.clipType || mode
      };
      let body = '';
      if (mode === 'selection' && data.selectionText && !stripTags(data.html).trim()) {
        body = '> ' + data.selectionText.split('\n').join('\n> ');
      } else {
        body = MC.htmlToMarkdown(data.html, { stripImages: !S.keepImages, stripLinks: !S.keepLinks }, meta.url);
      }
      if (!body.trim()) body = '> (empty selection — page had no readable text)';
      finishClip(meta, body, meta.clipType);
    } catch (e) {
      toast('Clip failed: ' + (e && e.message ? e.message : e), 'err');
    } finally { progress(1); setBusy(false); }
  }
  function stripTags(h) { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent || ''; }
  function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  function saveBookmarkClip(m, type) {
    m.date = Date.now(); m.dateISO = new Date().toISOString(); m.clipType = type || 'bookmark';
    const body = '[' + m.title + '](' + m.url + ')';
    finishClip(m, body, m.clipType);
  }
  function finishClip(meta, bodyMd, type) {
    const rt = MC.readingTime(bodyMd);
    const full = {
      id: uid(), title: meta.title || 'Untitled', url: meta.url || '', site: meta.site || '',
      author: meta.author || '', clipType: type || 'article',
      tags: guessTags(meta), starred: false,
      createdAt: Date.now(), updatedAt: Date.now(),
      words: rt.words, reading: rt.label, excerpt: MC.excerpt(bodyMd),
      markdown: MC.wrapDocument(bodyMd, { ...meta, words: rt.words, reading: rt.label, excerpt: MC.excerpt(bodyMd), tags: guessTags(meta) }, optsFromSettings())
    };
    // re-extract tags after wrap (frontmatter uses same tags)
    clips.unshift(full);
    curId = full.id;
    saveClips().then(renderAll);
    if (S.autoshow) goTab('current');
    renderCurrent();
    toast('Clipped: ' + full.title.slice(0, 60), 'ok');
  }
  function guessTags(meta) {
    const t = [];
    if (meta.site) t.push(meta.site.split('.')[0].toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20));
    return t.filter(Boolean).slice(0, 3);
  }
  function setBusy(b) { const d = $('#dot'); d.className = 'dot' + (b ? ' busy' : ' ok'); }

  /* ---------- PHOTO LAB CORE (fast, unlimited, free) ---------- */
  function upsertPageImage(im) {
    if (!im || !im.src) return;
    if (!pageImages.some((x) => x.src === im.src)) pageImages.unshift(im);
  }
  function photoFilterOpts() {
    return { minW: S.minW || 0, minH: 0, skipData: S.skipData !== false, skipIcons: (S.skipIcons !== false) || hideIconsUI, onlyPhotos: false };
  }
  function visiblePhotos() {
    let arr = MC.filterImages(pageImages, photoFilterOpts());
    if (hideIconsUI) arr = arr.filter((im) => (im.w || 400) >= 120);
    if (imgQ) {
      const n = imgQ.toLowerCase();
      arr = arr.filter((im) => ((im.alt || '') + ' ' + im.src).toLowerCase().includes(n));
    }
    if (imgSort === 'size') arr = arr.slice().sort((a, b) => ((b.w || 0) * (b.h || 1)) - ((a.w || 0) * (a.h || 1)));
    else if (imgSort === 'az') arr = arr.slice().sort((a, b) => String(a.alt || a.src).localeCompare(String(b.alt || b.src)));
    return arr;
  }
  function selectedPhotos() {
    const vis = visiblePhotos();
    if (!selSrc.size) return vis; // all = selected when nothing ticked
    return vis.filter((im) => selSrc.has(im.src));
  }
  async function grabPhotos(tab) {
    try {
      tab = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!tab || cannotInject(tab.url)) { toast('Open a webpage first', 'err'); return; }
      progress(0.3);
      const data = await extractFromTab(tab.id, 'images');
      const imgs = (data && data.images) || [];
      pageImages = imgs;
      selSrc = new Set();
      if (!imgs.length) toast('No images found on this page', 'err');
      else toast(imgs.length + ' photos grabbed', 'ok');
      goTab('photos');
      renderPhotos();
      renderStats();
    } catch (e) { toast('Photos failed: ' + (e && e.message ? e.message : e), 'err'); }
    finally { progress(1); setBusy(false); }
  }
  function downscaleImage(dataUrl, maxW, quality) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, (maxW || 1100) / (img.width || maxW || 1100));
            const w = Math.max(1, Math.round(img.width * scale)), h = Math.max(1, Math.round(img.height * scale));
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL(S.shotFmt === 'jpeg' ? 'image/jpeg' : 'image/png', quality || 0.85));
          } catch (e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
      } catch (e) { resolve(dataUrl); }
    });
  }
  async function takeScreenshot(tab) {
    try {
      progress(0.4); setBusy(true);
      tab = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!tab || !tab.windowId == null) {}
      const winId = tab ? tab.windowId : undefined;
      let url = await chrome.tabs.captureVisibleTab(winId, { format: S.shotFmt === 'jpeg' ? 'jpeg' : 'png', quality: 85 });
      // keep panel copy light: downscale embed to max 1100px
      const small = await downscaleImage(url, 1100, 0.85);
      shotDataUrl = small; shotMeta = { title: (tab && tab.title) || 'Screenshot', url: (tab && tab.url) || '', site: hostOf((tab && tab.url) || ''), at: Date.now(), full: url };
      $('#shotPrev').src = small; $('#shotPrev').hidden = false; $('#shotRow').hidden = false;
      goTab('photos');
      toast('Screenshot captured', 'ok');
    } catch (e) { toast('Screenshot blocked on this page', 'err'); }
    finally { progress(1); setBusy(false); }
  }
  function galleryBody(list, meta) {
    const withCaps = S.captions !== false;
    return MC.galleryMarkdown(list.map((im) => ({ ...im, alt: withCaps ? (im.alt || '') : '' })), meta, { withSource: true });
  }
  function saveGalleryClip() {
    const list = selectedPhotos();
    if (!list.length) return toast('Tick at least one photo', 'err');
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((ts) => {
      const tab = ts && ts[0];
      const meta = { title: 'Photos — ' + ((tab && tab.title) || hostOf((tab && tab.url) || '') || 'gallery').slice(0, 70), url: (tab && tab.url) || '', site: hostOf((tab && tab.url) || ''), date: Date.now(), dateISO: new Date().toISOString(), clipType: 'gallery' };
      finishClip(meta, galleryBody(list, meta) + '\n*Total photos: ' + list.length + '*', 'gallery');
    });
  }
  function saveShotClip() {
    if (!shotDataUrl) return toast('Take a screenshot first', 'err');
    const m = { title: 'Screenshot — ' + ((shotMeta && shotMeta.title) || 'page').slice(0, 70), url: (shotMeta && shotMeta.url) || '', site: (shotMeta && shotMeta.site) || '', date: Date.now(), dateISO: new Date().toISOString(), clipType: 'screenshot' };
    const body = '![screenshot](' + shotDataUrl + ')\n\n*Captured ' + new Date().toLocaleString() + (m.url ? ' — [' + (m.site || m.url) + '](' + m.url + ')' : '') + '*';
    finishClip(m, body, 'screenshot');
  }

  /* ---------- render library ---------- */
  function filtered() {
    let arr = clips.slice();
    if (fType) arr = arr.filter((c) => c.clipType === fType);
    if (S.filterStar) arr = arr.filter((c) => c.starred);
    if (tagFilter) arr = arr.filter((c) => (c.tags || []).includes(tagFilter));
    if (q) {
      const needle = q.toLowerCase();
      arr = arr.filter((c) => (c.title + ' ' + c.site + ' ' + c.excerpt + ' ' + (c.tags || []).join(' ') + ' ' + c.markdown).toLowerCase().includes(needle));
    }
    if (fSort === 'old') arr.sort((a, b) => a.createdAt - b.createdAt);
    else if (fSort === 'az') arr.sort((a, b) => String(a.title).localeCompare(String(b.title)));
    else if (fSort === 'words') arr.sort((a, b) => (b.words || 0) - (a.words || 0));
    else arr.sort((a, b) => b.createdAt - a.createdAt);
    return arr;
  }
  function renderList() {
    const box = $('#clipList');
    const arr = filtered();
    $('#libEmpty').hidden = clips.length !== 0;
    box.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const c of arr.slice(0, 400)) {
      const d = document.createElement('div');
      d.className = 'clip' + (c.id === curId ? ' sel' : '');
      d.innerHTML =
        '<div class="tt">' + esc(c.title) + '</div>' +
        '<div class="ss">' + esc(c.excerpt || '') + '</div>' +
        '<div class="mm"><span class="badge">' + esc(c.clipType) + '</span>' +
        (c.starred ? '<span class="badge star">★</span>' : '') +
        '<span class="grow">' + esc(c.site || '') + ' · ' + (c.words || 0) + 'w</span>' +
        '<button class="rowx" data-x="star" title="Star">★</button>' +
        '<button class="rowx" data-x="copy" title="Copy">⧉</button>' +
        '<button class="rowx" data-x="del" title="Delete">✕</button></div>';
      d.addEventListener('click', (e) => {
        const x = e.target.closest('[data-x]');
        if (x) {
          e.stopPropagation();
          if (x.dataset.x === 'del') delClip(c.id);
          else if (x.dataset.x === 'star') toggleStar(c.id);
          else if (x.dataset.x === 'copy') copyText(c.markdown, 'Markdown copied');
          return;
        }
        curId = c.id; renderAll(); goTab('current');
      });
      frag.appendChild(d);
    }
    box.appendChild(frag);
    // tag chips
    const counts = {};
    clips.forEach((c) => (c.tags || []).forEach((t) => { counts[t] = (counts[t] || 0) + 1; }));
    const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 12);
    $('#tagChips').innerHTML = tags.map((t) =>
      '<button class="fchip' + (tagFilter === t ? ' on' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + ' ' + counts[t] + '</button>').join('');
    $$('#tagChips [data-tag]').forEach((b) => b.addEventListener('click', () => {
      tagFilter = tagFilter === b.dataset.tag ? '' : b.dataset.tag; renderList();
    }));
  }
  function cur() { return clips.find((c) => c.id === curId) || clips[0] || null; }

  function renderCurrent() {
    const c = cur();
    if (!c) {
      $('#curTitle').textContent = 'No page yet';
      $('#curMeta').textContent = 'Press Article / Full / Select / Mark, or use right-click → markClipper.';
      $('#viewPreview').innerHTML = '<p style="color:var(--muted)">Nothing clipped yet.</p>';
      $('#mdSource').value = ''; $('#metaBox').innerHTML = ''; return;
    }
    curId = c.id;
    $('#curTitle').textContent = c.title;
    $('#curMeta').textContent = (c.site || '') + ' · ' + c.clipType + ' · ' + (c.words || 0) + ' words · ' + (c.reading || '');
    $('#viewPreview').innerHTML = MC.mdToHtml(c.markdown);
    if (document.activeElement !== $('#mdSource')) $('#mdSource').value = c.markdown;
    $('#fldTitle').value = c.title;
    $('#fldTags').value = (c.tags || []).join(', ');
    $('#btnStar').textContent = c.starred ? '★ Starred' : '★ Star';
    $('#metaBox').innerHTML =
      kv('Title', c.title) + kv('Site', c.site) + kv('Type', c.clipType) +
      kv('Words', c.words) + kv('Reading', c.reading) +
      kv('Photos', MC.countImagesInMarkdown(c.markdown)) +
      kv('Created', new Date(c.createdAt).toLocaleString()) +
      kv('File', MC.filenameFromTemplate(S.tpl, { title: c.title, site: c.site, date: c.createdAt, clipType: c.clipType })) +
      (c.url ? '<div class="kv"><span>URL</span><a href="' + esc(c.url) + '" target="_blank" rel="noopener">open ↗</a></div>' : '');
    renderNotes();
  }
  function kv(k, v) { return '<div class="kv"><span>' + esc(k) + '</span><b>' + esc(String(v == null ? '' : v)).slice(0, 90) + '</b></div>'; }

  function renderStats() {
    $('#stTotal').textContent = clips.length;
    $('#stWords').textContent = clips.reduce((a, c) => a + (c.words || 0), 0).toLocaleString();
    $('#stSites').textContent = new Set(clips.map((c) => c.site).filter(Boolean)).size;
    $('#stStreak').textContent = streak();
    try {
      $('#stPhotos').textContent = pageImages.length;
      $('#stImgs').textContent = clips.reduce((a, c) => a + MC.countImagesInMarkdown(c.markdown), 0);
    } catch (e) {}
    $('#sbCount').textContent = clips.length + (clips.length === 1 ? ' clip' : ' clips');
    $('#sbWords').textContent = clips.reduce((a, c) => a + (c.words || 0), 0).toLocaleString() + ' words';
  }
  function streak() {
    const days = (S._days || []).slice().sort();
    if (!days.length) return 0;
    let s = 1;
    for (let i = days.length - 1; i > 0; i--) {
      const a = new Date(days[i]), b = new Date(days[i - 1]);
      const diff = Math.round((a - b) / 86400000);
      if (diff === 1) s++; else if (diff === 0) continue; else break;
    }
    return s;
  }
  function renderAll() { renderList(); renderCurrent(); renderStats(); renderTodos(); renderPhotos(); }

  /* ---------- PHOTOS render (debounced, lazy, fast) ---------- */
  function renderPhotos() {
    const grid = $('#imgGrid'); if (!grid) return;
    const vis = visiblePhotos();
    const sel = selectedPhotos();
    $('#imgEmpty').hidden = vis.length !== 0;
    $('#photosTitle').textContent = pageImages.length ? pageImages.length + ' photos · ' + sel.length + ' selected' : 'No photos yet';
    $('#photosMeta').textContent = pageImages.length
      ? 'Tick photos, then Save gallery / Copy MD / Download. Unticked = all selected.'
      : 'Press Photos to grab every image from the open page.';
    grid.innerHTML = '';
    const frag = document.createDocumentFragment();
    vis.slice(0, 250).forEach((im, idx) => {
      const d = document.createElement('div');
      const on = !selSrc.size || selSrc.has(im.src);
      d.className = 'img-cell' + (on && selSrc.size ? ' sel' : selSrc.size ? '' : ' sel');
      d.innerHTML = '<img loading="lazy" src="' + esc(im.src) + '" alt="">' +
        ((im.w || im.h) ? '<span class="dim">' + (im.w || '?') + '×' + (im.h || '?') + '</span>' : '') +
        '<span class="pick">' + (on && selSrc.size ? '<svg class="ic"><use href="#i-check"/></svg>' : '<svg class="ic"><use href="#i-plus"/></svg>') + '</span>' +
        (im.alt ? '<span class="cap">' + esc(im.alt) + '</span>' : '');
      d.title = (im.alt || im.src).slice(0, 160);
      d.addEventListener('click', (e) => {
        if (selSrc.has(im.src)) selSrc.delete(im.src); else selSrc.add(im.src);
        // if all selected manually, reset to "all" state
        if (selSrc.size >= vis.length) selSrc = new Set();
        renderPhotos();
      });
      d.addEventListener('dblclick', () => openLightbox(idx));
      frag.appendChild(d);
    });
    grid.appendChild(frag);
    const mv = $('#imgMinV'); if (mv) mv.textContent = (S.minW || 0) + 'px';
    const im = $('#imgMin'); if (im && document.activeElement !== im) im.value = S.minW || 0;
  }
  const renderPhotosFast = (() => { let t; return () => { clearTimeout(t); t = setTimeout(renderPhotos, 90); }; })();
  function openLightbox(i) {
    const vis = visiblePhotos(); if (!vis.length) return;
    lbIndex = Math.max(0, Math.min(i || 0, vis.length - 1));
    paintLightbox();
    $('#lightbox').classList.add('show');
  }
  function paintLightbox() {
    const vis = visiblePhotos(); const im = vis[lbIndex]; if (!im) return;
    $('#lbImg').src = im.src;
    $('#lbCap').textContent = ((im.alt || 'Photo ' + (lbIndex + 1)) + ' · ' + (im.w || '?') + '×' + (im.h || '?') + ' · ' + (lbIndex + 1) + '/' + vis.length).slice(0, 140);
  }
  function closeLightbox() { $('#lightbox').classList.remove('show'); $('#lbImg').removeAttribute('src'); }

  /* ---------- mutations ---------- */
  function delClip(id) {
    clips = clips.filter((c) => c.id !== id);
    delete notes[id];
    if (curId === id) curId = clips[0] ? clips[0].id : null;
    saveClips(); saveNotes(); renderAll(); toast('Clip deleted');
  }
  function toggleStar(id) {
    const c = clips.find((x) => x.id === id); if (!c) return;
    c.starred = !c.starred; c.updatedAt = Date.now();
    saveClips(); renderAll(); toast(c.starred ? 'Starred' : 'Unstarred', 'ok');
  }
  async function copyText(t, msg) {
    try { await navigator.clipboard.writeText(t); toast(msg || 'Copied', 'ok'); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(msg || 'Copied', 'ok'); } catch (e2) { toast('Copy failed', 'err'); }
      ta.remove();
    }
  }
  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fnameFor(c, ext) {
    let f = MC.filenameFromTemplate(S.tpl, { title: c.title, site: c.site, date: c.createdAt, clipType: c.clipType });
    return f.replace(/\.md$/i, '') + ext;
  }
  function toHtmlDoc(c) {
    return '<!doctype html><meta charset="utf-8"><title>' + esc(c.title) + '</title><body style="font-family:system-ui;max-width:760px;margin:32px auto;padding:0 16px">' +
      '<h1>' + esc(c.title) + '</h1><p><a href="' + esc(c.url) + '">' + esc(c.site || c.url) + '</a></p><hr>' +
      MC.mdToHtml(c.markdown) + '</body>';
  }

  /* ---------- notes / todos ---------- */
  function renderNotes() {
    const c = cur(); const box = $('#noteList');
    const arr = c && notes[c.id] ? notes[c.id] : [];
    box.innerHTML = arr.length ? '' : '<p style="font-size:12px;color:var(--muted)">No notes yet.</p>';
    arr.forEach((n, i) => {
      const d = document.createElement('div');
      d.className = 'note-item';
      d.innerHTML = '<div class="meta">' + esc(n.t) + '<div style="font-size:11px;color:var(--muted);margin-top:4px">' + new Date(n.at).toLocaleString() + '</div></div><button class="rowx">✕</button>';
      d.querySelector('.rowx').addEventListener('click', () => { notes[c.id].splice(i, 1); saveNotes(); renderNotes(); });
      box.appendChild(d);
    });
  }
  function renderTodos() {
    const box = $('#todoList'); box.innerHTML = '';
    if (!todos.length) box.innerHTML = '<p style="font-size:12px;color:var(--muted)">No todos. Add your first above.</p>';
    todos.forEach((t, i) => {
      const d = document.createElement('div');
      d.className = 'todo-row' + (t.done ? ' done' : '');
      d.innerHTML = '<button class="todo-check' + (t.done ? ' done' : '') + '">' + (t.done ? '<svg class="ic"><use href="#i-check"/></svg>' : '') + '</button><span class="todo-txt">' + esc(t.t) + '</span><button class="rowx">✕</button>';
      d.querySelector('.todo-check').addEventListener('click', () => { t.done = !t.done; saveTodos(); renderTodos(); });
      d.querySelector('.rowx').addEventListener('click', () => { todos.splice(i, 1); saveTodos(); renderTodos(); });
      box.appendChild(d);
    });
  }

  /* ---------- export / backup ---------- */
  function exportAll() {
    if (!clips.length) return toast('Nothing to export', 'err');
    clips.forEach((c, i) => setTimeout(() => download(fnameFor(c, '.md'), c.markdown), i * 250));
    toast('Exporting ' + clips.length + ' .md files…', 'ok');
  }

  /* ---------- modal: shortcuts ---------- */
  function openModal(title, html, foot) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = html;
    $('#modalFoot').hidden = !foot;
    if (foot) $('#modalFoot').innerHTML = foot;
    $('#modalBack').classList.add('show');
  }
  function closeModal() { $('#modalBack').classList.remove('show'); }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalBack').addEventListener('click', (e) => { if (e.target.id === 'modalBack') closeModal(); });
  function showShortcuts() {
    openModal('Keyboard shortcuts',
      '<div class="kbd-grid">' +
      '<span>Open markClipper panel</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>K</kbd></span>' +
      '<span>Clip article</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>A</kbd></span>' +
      '<span>Clip selection</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>S</kbd></span>' +
      '<span>Grab photos</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>I</kbd></span>' +
      '<span>Screenshot page</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>P</kbd></span>' +
      '<span>Clip bookmark</span><span><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>B</kbd></span>' +
      '<span>Add note (in note box)</span><span><kbd>Ctrl</kbd> <kbd>Enter</kbd></span>' +
      '<span>Close dialog</span><span><kbd>Esc</kbd></span></div>' +
      '<p style="font-size:12px;color:var(--muted);margin-top:12px">Change keys at chrome://extensions/shortcuts.</p>');
  }

  /* ---------- menu ---------- */
  const menu = $('#menu');
  function toggleMenu(show, x, y) {
    if (show) {
      menu.classList.add('show');
      menu.style.left = Math.min(x || 40, innerWidth - 250) + 'px';
      menu.style.top = (y || 60) + 'px';
    } else menu.classList.remove('show');
  }
  $('#btnMenu').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    toggleMenu(!menu.classList.contains('show'), r.left - 190, r.bottom + 8);
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#menu,#btnMenu')) toggleMenu(false); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    toggleMenu(false);
    menuAct(b.dataset.act);
  });
  function menuAct(a) {
    if (a === 'clip-article') clip(S.mode === 'article' ? 'article' : S.mode);
    else if (a === 'clip-full') clip('full');
    else if (a === 'clip-selection') clip('selection');
    else if (a === 'clip-images') clip('images');
    else if (a === 'clip-shot') clip('screenshot');
    else if (a === 'clip-bookmark') clip('bookmark');
    else if (a === 'export-all') exportAll();
    else if (a === 'backup') doBackup();
    else if (a === 'shortcuts') showShortcuts();
  }

  /* ---------- wire buttons ---------- */
  $('#btnClipArticle').addEventListener('click', () => clip('article'));
  $('#btnClipFull').addEventListener('click', () => clip('full'));
  $('#btnClipSel').addEventListener('click', () => clip('selection'));
  $('#btnClipPhotos').addEventListener('click', () => clip('images'));
  $('#btnClipShot').addEventListener('click', () => clip('screenshot'));
  $('#btnClipBm').addEventListener('click', () => clip('bookmark'));
  $('#btnGrabPhotos').addEventListener('click', () => clip('images'));
  $('#btnShot').addEventListener('click', () => clip('screenshot'));
  $('#btnSaveGallery').addEventListener('click', saveGalleryClip);
  $('#btnCopyGallery').addEventListener('click', () => {
    const list = selectedPhotos();
    if (!list.length) return toast('No photos selected', 'err');
    copyText(galleryBody(list, null), list.length + ' photos copied as MD');
  });
  $('#btnDlGallery').addEventListener('click', async () => {
    const list = selectedPhotos();
    if (!list.length) return toast('No photos selected', 'err');
    toast('Downloading ' + list.length + ' photos…', 'ok');
    const ts = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const site = hostOf((ts[0] && ts[0].url) || '');
    list.slice(0, 60).forEach((im, i) => {
      try {
        chrome.downloads.download({ url: im.src, filename: 'markclipper/' + MC.guessImageName(im.src, i, site), conflictAction: 'uniquify', saveAs: false });
      } catch (e) {}
    });
  });
  $('#btnOpenAll').addEventListener('click', () => openLightbox(0));
  $('#btnSaveShot').addEventListener('click', saveShotClip);
  $('#btnDlShot').addEventListener('click', () => {
    if (!shotMeta || !shotMeta.full) return toast('No screenshot', 'err');
    try { chrome.downloads.download({ url: shotMeta.full, filename: 'markclipper/screenshot-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.png', saveAs: false }); toast('Screenshot downloading', 'ok'); }
    catch (e) { download('screenshot.png', '', 'image/png'); }
  });
  $('#btnCopyShot').addEventListener('click', () => {
    if (!shotDataUrl) return toast('No screenshot', 'err');
    copyText('![screenshot](' + shotDataUrl.slice(0, 200000) + ')', 'Screenshot MD copied');
  });
  $('#imgQ').addEventListener('input', debounce((e) => { imgQ = e.target.value.trim(); renderPhotosFast(); }, 120));
  $('#imgSort').addEventListener('change', (e) => { imgSort = e.target.value; renderPhotos(); });
  $('#imgSelAll').addEventListener('click', () => { selSrc = new Set(); renderPhotos(); });
  $('#imgSelNone').addEventListener('click', () => { const v = visiblePhotos(); selSrc = new Set(v.map((x) => x.src)); renderPhotos(); toast('All unticked — tap to pick'); });
  $('#imgHideIcons').addEventListener('click', (e) => { hideIconsUI = !hideIconsUI; e.currentTarget.classList.toggle('on', hideIconsUI); renderPhotos(); });
  $('#imgMin').addEventListener('input', debounce((e) => { S.minW = Number(e.target.value); $('#imgMinV').textContent = S.minW + 'px'; saveSet(); renderPhotosFast(); }, 120));
  // lightbox
  $('#lbClose').addEventListener('click', closeLightbox);
  $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox' || e.target.id === 'lbImg') closeLightbox(); });
  $('#lbPrev').addEventListener('click', () => { lbIndex = Math.max(0, lbIndex - 1); paintLightbox(); });
  $('#lbNext').addEventListener('click', () => { const v = visiblePhotos(); lbIndex = Math.min(v.length - 1, lbIndex + 1); paintLightbox(); });
  $('#lbCopy').addEventListener('click', () => { const v = visiblePhotos(); const im = v[lbIndex]; if (im) copyText(MC.imageMarkdown(im, lbIndex), 'Photo MD copied'); });
  $('#lbDl').addEventListener('click', async () => {
    const v = visiblePhotos(); const im = v[lbIndex]; if (!im) return;
    try { chrome.downloads.download({ url: im.src, filename: 'markclipper/' + MC.guessImageName(im.src, lbIndex, ''), saveAs: false }); toast('Downloading photo', 'ok'); }
    catch (e) { toast('Download blocked', 'err'); }
  });
  $('#lbOpen').addEventListener('click', () => { const v = visiblePhotos(); const im = v[lbIndex]; if (im) chrome.tabs.create({ url: im.src }); });
  $('#btnReclip').addEventListener('click', () => clip(S.mode || 'article'));
  $('#btnOpenPage').addEventListener('click', async () => {
    const c = cur(); if (c && c.url) chrome.tabs.create({ url: c.url });
    else { const t = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t[0]) chrome.tabs.create({ url: t[0].url }); }
  });
  $('#btnTheme').addEventListener('click', cycleTheme);
  $('#sbTheme').addEventListener('click', cycleTheme);
  function cycleTheme() {
    S.theme = S.theme === 'dark' ? 'light' : S.theme === 'light' ? 'system' : 'dark';
    applyTheme(); saveSet(); toast('Theme: ' + S.theme, 'ok');
  }
  $('#btnShortcuts').addEventListener('click', showShortcuts);
  $('#fStar').addEventListener('click', (e) => { S.filterStar = !S.filterStar; e.currentTarget.classList.toggle('on', S.filterStar); renderList(); });
  $('#fType').addEventListener('change', (e) => { fType = e.target.value; renderList(); });
  $('#fSort').addEventListener('change', (e) => { fSort = e.target.value; renderList(); });
  $('#q').addEventListener('input', debounce((e) => { q = e.target.value.trim(); renderList(); }, 120));
  $('#btnExportAll').addEventListener('click', exportAll);

  $('#btnCopyMd').addEventListener('click', () => { const c = cur(); if (c) copyText(c.markdown, 'Markdown copied'); });
  $('#sbCopy').addEventListener('click', () => { const c = cur(); if (c) copyText(c.markdown, 'Markdown copied'); else toast('Nothing to copy', 'err'); });
  $('#btnDownloadMd').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.md'), c.markdown); });
  $('#sbDl').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.md'), c.markdown); else toast('Nothing to download', 'err'); });
  $('#btnSaveEdit').addEventListener('click', () => {
    const c = cur(); if (!c) return;
    c.markdown = $('#mdSource').value;
    const rt = MC.readingTime(c.markdown);
    c.words = rt.words; c.reading = rt.label; c.excerpt = MC.excerpt(c.markdown); c.updatedAt = Date.now();
    saveClips(); renderAll(); toast('Saved', 'ok');
  });
  $('#btnSaveMeta').addEventListener('click', () => {
    const c = cur(); if (!c) return;
    c.title = $('#fldTitle').value.trim() || c.title;
    c.tags = $('#fldTags').value.split(',').map((s) => s.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean).slice(0, 8);
    c.updatedAt = Date.now(); saveClips(); renderAll(); toast('Saved', 'ok');
  });
  $('#btnStar').addEventListener('click', () => { const c = cur(); if (c) toggleStar(c.id); });
  $('#btnDelete').addEventListener('click', () => { const c = cur(); if (c) delClip(c.id); });
  $('#btnExpMd').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.md'), c.markdown); });
  $('#btnExpHtml').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.html'), toHtmlDoc(c), 'text/html'); });
  $('#btnExpTxt').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.txt'), c.markdown.replace(/^---[\s\S]*?---/, '').trim(), 'text/plain'); });
  $('#btnExpJson').addEventListener('click', () => { const c = cur(); if (c) download(fnameFor(c, '.json'), JSON.stringify(c, null, 2), 'application/json'); });

  $('#btnAddNote').addEventListener('click', addNote);
  $('#noteInput').addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') addNote(); });
  function addNote() {
    const c = cur(); if (!c) return toast('Clip something first', 'err');
    const v = $('#noteInput').value.trim(); if (!v) return;
    (notes[c.id] = notes[c.id] || []).unshift({ t: v, at: Date.now() });
    $('#noteInput').value = ''; saveNotes(); renderNotes(); toast('Note added', 'ok');
  }
  $('#btnAddTodo').addEventListener('click', addTodo);
  $('#todoInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTodo(); });
  function addTodo() {
    const v = $('#todoInput').value.trim(); if (!v) return;
    todos.unshift({ t: v, done: false, at: Date.now() });
    $('#todoInput').value = ''; saveTodos(); renderTodos();
  }

  function doBackup() {
    download('markclipper-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ app: 'markClipper', v: 1, at: new Date().toISOString(), clips, notes, todos, settings: S }, null, 2), 'application/json');
    toast('Backup downloaded', 'ok');
  }
  $('#btnBackup').addEventListener('click', doBackup);
  $('#btnRestore').addEventListener('click', () => $('#fileRestore').click());
  $('#fileRestore').addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (Array.isArray(d.clips)) clips = d.clips;
        if (d.notes) notes = d.notes;
        if (Array.isArray(d.todos)) todos = d.todos;
        if (d.settings) S = { ...DEFAULTS, ...d.settings };
        curId = clips[0] ? clips[0].id : null;
        Promise.all([saveClips(), saveNotes(), saveTodos(), saveSet()]).then(() => { syncSettingsUI(); renderAll(); applyTheme(); applyReading(); });
        toast('Restored ' + clips.length + ' clips', 'ok');
      } catch (err) { toast('Invalid backup file', 'err'); }
    };
    r.readAsText(f); e.target.value = '';
  });
  $('#btnWipe').addEventListener('click', () => {
    openModal('Delete everything?',
      '<p style="font-size:13px">This removes <b>' + clips.length + ' clips</b>, notes, todos and settings from this device. This cannot be undone. Backup first if unsure.</p>',
      '<button class="btn ghost" id="mCancel">Cancel</button><button class="btn danger" id="mWipe" style="background:var(--danger);color:#fff">Delete all</button>');
    $('#modalFoot').hidden = false;
    $('#mCancel').addEventListener('click', closeModal);
    $('#mWipe').addEventListener('click', async () => {
      clips = []; notes = {}; todos = []; curId = null;
      await chrome.storage.local.remove([LS_CLIPS, LS_NOTES, LS_TODOS]);
      closeModal(); renderAll(); toast('Everything deleted');
    });
  });

  /* ---------- settings UI ---------- */
  function syncSettingsUI() {
    $('#setTheme').value = S.theme; $('#setWidth').value = S.width; $('#setFont').value = S.font;
    $('#setMode').value = S.mode; $('#setAutoshow').checked = !!S.autoshow; $('#setAutoclip').checked = !!S.autoclip;
    $('#setFm').checked = !!S.frontmatter; $('#setH1').checked = !!S.titleH1; $('#setSrc').checked = !!S.sourceLine;
    $('#setImg').checked = !!S.keepImages; $('#setLinks').checked = !!S.keepLinks;
    $('#setTables').checked = S.keepTables !== false; $('#setCode').checked = S.keepCode !== false;
    $('#setHiRes').checked = S.hiRes !== false; $('#setSkipIcons').checked = S.skipIcons !== false;
    $('#setSkipData').checked = S.skipData !== false; $('#setBg').checked = S.includeBg !== false;
    $('#setCaps').checked = S.captions !== false;
    $('#setMinW').value = S.minW || 0; $('#setMinWV').textContent = (S.minW || 0) + 'px';
    $('#setShotFmt').value = S.shotFmt || 'png';
    $('#setTpl').value = S.tpl || '{date}-{slug}';
    $('#setFontV').textContent = S.font + 'px';
  }
  function bindSettings() {
    $('#setTheme').addEventListener('change', (e) => { S.theme = e.target.value; applyTheme(); saveSet(); });
    $('#setWidth').addEventListener('change', (e) => { S.width = e.target.value; applyReading(); saveSet(); });
    $('#setFont').addEventListener('input', (e) => { S.font = Number(e.target.value); applyReading(); saveSet(); });
    $('#setMode').addEventListener('change', (e) => { S.mode = e.target.value; saveSet(); });
    $('#setAutoshow').addEventListener('change', (e) => { S.autoshow = e.target.checked; saveSet(); });
    $('#setAutoclip').addEventListener('change', (e) => { S.autoclip = e.target.checked; saveSet(); });
    $('#setFm').addEventListener('change', (e) => { S.frontmatter = e.target.checked; saveSet(); });
    $('#setH1').addEventListener('change', (e) => { S.titleH1 = e.target.checked; saveSet(); });
    $('#setSrc').addEventListener('change', (e) => { S.sourceLine = e.target.checked; saveSet(); });
    $('#setImg').addEventListener('change', (e) => { S.keepImages = e.target.checked; saveSet(); });
    $('#setLinks').addEventListener('change', (e) => { S.keepLinks = e.target.checked; saveSet(); });
    $('#setTables').addEventListener('change', (e) => { S.keepTables = e.target.checked; saveSet(); });
    $('#setCode').addEventListener('change', (e) => { S.keepCode = e.target.checked; saveSet(); });
    $('#setHiRes').addEventListener('change', (e) => { S.hiRes = e.target.checked; saveSet(); });
    $('#setSkipIcons').addEventListener('change', (e) => { S.skipIcons = e.target.checked; saveSet(); renderPhotosFast(); });
    $('#setSkipData').addEventListener('change', (e) => { S.skipData = e.target.checked; saveSet(); renderPhotosFast(); });
    $('#setBg').addEventListener('change', (e) => { S.includeBg = e.target.checked; saveSet(); });
    $('#setCaps').addEventListener('change', (e) => { S.captions = e.target.checked; saveSet(); });
    $('#setMinW').addEventListener('input', (e) => { S.minW = Number(e.target.value); $('#setMinWV').textContent = S.minW + 'px'; saveSet(); renderPhotosFast(); });
    $('#setShotFmt').addEventListener('change', (e) => { S.shotFmt = e.target.value; saveSet(); });
    $('#setTpl').addEventListener('input', debounce((e) => { S.tpl = e.target.value || '{date}-{slug}'; saveSet(); }, 300));
  }

  /* ---------- external clip requests (context menu / commands) ---------- */
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === 'mc-clip-request' && msg.mode) clip(msg.mode, msg.info || {});
  });
  async function consumePending() {
    try {
      const r = await chrome.storage.session.get('mcPending');
      const p = r && r.mcPending;
      if (p && Date.now() - p.at < 30000) {
        await chrome.storage.session.remove('mcPending');
        clip(p.mode || 'article', p.info || {});
      }
    } catch (e) {}
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeModal(); toggleMenu(false); closeLightbox(); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); clip('images'); }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); clip('screenshot'); }
  });

  /* ---------- boot (fast) ---------- */
  (async function boot() {
    progress(0.4);
    await load();
    syncSettingsUI(); bindSettings(); applyTheme(); applyReading();
    curId = clips[0] ? clips[0].id : null;
    renderAll();
    progress(0.9);
    consumePending();
    progress(1);
  })();
})();
