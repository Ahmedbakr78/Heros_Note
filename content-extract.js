'use strict';
/* markClipper extractor — injected into the active tab on demand (no persistent content script = fast). */
(function () {
  function meta(name, prop) {
    try {
      const el = document.querySelector(name ? 'meta[name="' + name + '"]' : 'meta[property="' + prop + '"]');
      return el ? (el.getAttribute('content') || '') : '';
    } catch (e) { return ''; }
  }
  function pageMeta() {
    const url = location.href;
    let site = '';
    try { site = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    return {
      title: (document.title || '').trim() || 'Untitled',
      url,
      site,
      author: meta('author') || meta('', 'article:author') || meta('', 'og:site_name') || '',
      description: meta('description') || meta('', 'og:description') || '',
      dateISO: new Date().toISOString()
    };
  }
  // Readability-lite scoring duplicated small here so injection is single-file
  function pickMain() {
    const UNLIKELY = /combx|comment|community|disqus|extra|foot|header|menu|remark|rss|shoutbox|sidebar|sponsor|ad-break|agegate|pagination|pager|popup|tweet|twitter|social|modal|overlay|cookie|consent|newsletter|subscribe|related|recommend|share|toolbar|dropdown|login|signin|promo|banner|nav/i;
    const LIKELY = /and|article|body|column|main|shadow|content|post|story|entry|text|blog|page/i;
    const prefer = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content', '#content'];
    for (const s of prefer) {
      try { const el = document.querySelector(s); if (el && (el.innerText || '').trim().length > 400) return el; } catch (e) {}
    }
    const paras = Array.from(document.querySelectorAll('p,pre,blockquote,li,h1,h2'));
    const scores = new Map();
    for (const p of paras) {
      const txt = (p.innerText || '').trim();
      if (txt.length < 80) continue;
      let score = Math.min(6, Math.floor(txt.length / 220)) + Math.min(3, (txt.match(/,/g) || []).length);
      let el = p.parentElement;
      for (let d = 0; d < 3 && el; d++) {
        const cls = (el.className || '') + ' ' + (el.id || '');
        if (UNLIKELY.test(cls) && !LIKELY.test(cls)) score -= 3;
        if (LIKELY.test(cls)) score += 2;
        scores.set(el, (scores.get(el) || 0) + score);
        el = el.parentElement;
      }
    }
    let best = null, bs = 8;
    for (const [el, sc] of scores) if (sc > bs) { bs = sc; best = el; }
    return best || document.body;
  }
  function clean(node) {
    const c = node.cloneNode(true);
    ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'form', 'button', 'input', 'select', 'textarea', 'nav', 'footer', 'aside',
     '.nav', '.navbar', '.menu', '.sidebar', '.widget', '.comments', '#comments', '.comment', '.ad', '.ads', '.advertisement', '.share', '.sharing',
     '.social', '.newsletter', '.subscribe', '.related', '.recommendations', '.popup', '.modal', '.cookie', '.consent', '.toolbar', '.promo', '.banner', 'header', '.header']
      .forEach((s) => { try { c.querySelectorAll(s).forEach((e) => e.remove()); } catch (e2) {} });
    c.querySelectorAll('[hidden],[aria-hidden="true"]').forEach((e) => e.remove());
    c.querySelectorAll('*').forEach((el) => { el.removeAttribute('style'); el.removeAttribute('onclick'); el.removeAttribute('onload'); });
    c.querySelectorAll('a[href]').forEach((a) => { try { a.href = a.href; } catch (e) {} });
    c.querySelectorAll('img[src]').forEach((img) => { try { img.src = img.src; img.removeAttribute('srcset'); } catch (e) {} });
    return c;
  }
  function abs(href) { try { return new URL(href, location.href).href; } catch (e) { return href || ''; } }
  function bestSrc(img) {
    try {
      const cands = [
        img.currentSrc, img.src,
        img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'), img.getAttribute('data-full'),
        img.getAttribute('srcset'), img.getAttribute('data-srcset')
      ].filter(Boolean);
      for (const c of cands) {
        const s = String(c).split(',')[0].trim().split(' ')[0];
        if (s && !s.startsWith('data:image/gif;base64,R0lGODlhAQAB')) return abs(s);
      }
    } catch (e) {}
    return '';
  }
  function collectImages() {
    const out = [], seen = new Set();
    function push(src, alt, title, w, h, kind, el) {
      if (!src || seen.has(src)) return;
      if (/^data:/i.test(src) && src.length > 60000) return; // skip huge inline placeholders here
      seen.add(src);
      out.push({ src, alt: String(alt || '').slice(0, 160), title: String(title || '').slice(0, 160), w: w || 0, h: h || 0, kind: kind || 'img' });
      if (out.length >= 250) return;
    }
    try {
      // og / twitter hero first
      const og = document.querySelector('meta[property="og:image"]');
      if (og && og.content) push(abs(og.content), document.title, 'og:image', 0, 0, 'hero');
      document.querySelectorAll('img').forEach((img) => {
        try {
          if (img.closest('nav,header,footer,.nav,.menu,.toolbar')) {
            // still include but mark chrome
          }
          const src = bestSrc(img);
          if (!src) return;
          const r = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0 };
          const w = img.naturalWidth || Math.round(r.width) || parseInt(img.getAttribute('width') || '0', 10) || 0;
          const h = img.naturalHeight || Math.round(r.height) || parseInt(img.getAttribute('height') || '0', 10) || 0;
          let cap = img.alt || img.title || '';
          const fig = img.closest('figure');
          if (fig) { const fc = fig.querySelector('figcaption'); if (fc && fc.innerText) cap = cap || fc.innerText.trim().slice(0, 160); }
          push(src, cap, img.title || '', w, h, 'img', img);
        } catch (e) {}
      });
      // picture > source srcset
      document.querySelectorAll('picture source[srcset]').forEach((s) => {
        try { const first = s.getAttribute('srcset').split(',')[0].trim().split(' ')[0]; if (first) push(abs(first), '', '', 0, 0, 'source'); } catch (e) {}
      });
      // linked image_src
      document.querySelectorAll('link[rel="image_src"]').forEach((l) => { try { push(abs(l.href), '', '', 0, 0, 'hero'); } catch (e) {} });
      // big background images (hero banners) — cheap pass, max 20
      let bgCount = 0;
      document.querySelectorAll('div,section,header,a').forEach((el) => {
        if (bgCount > 20 || out.length >= 250) return;
        try {
          const bg = getComputedStyle(el).backgroundImage || '';
          const m = bg.match(/url\(["']?(https?[^"')]+|data:image\/[^;]+;base64,[^"')]{0,40000})["']?\)/);
          if (m && m[1] && !seen.has(m[1])) {
            const r = el.getBoundingClientRect();
            if (r.width >= 200 && r.height >= 120) { push(abs(m[1]), '', '', Math.round(r.width), Math.round(r.height), 'bg'); bgCount++; }
          }
        } catch (e) {}
      });
    } catch (e) {}
    return out;
  }
  function selHtml() {
    try {
      const s = window.getSelection();
      if (!s || s.rangeCount === 0 || s.isCollapsed) return '';
      const div = document.createElement('div');
      for (let i = 0; i < s.rangeCount; i++) div.appendChild(s.getRangeAt(i).cloneContents());
      return div.innerHTML;
    } catch (e) { return ''; }
  }
  const mode = window.__mcMode || 'article';
  const m = pageMeta();
  let html = '', clipType = mode, images = [];
  try { images = collectImages(); } catch (e) { images = []; }
  try {
    if (mode === 'selection') {
      html = selHtml();
      if (!html) { const n = pickMain(); html = clean(n).innerHTML; clipType = 'article'; }
    } else if (mode === 'full') {
      html = clean(document.body).innerHTML;
    } else if (mode === 'images') {
      const n = pickMain(); html = clean(n).innerHTML;
    } else {
      html = clean(pickMain()).innerHTML;
    }
  } catch (e) { html = document.body ? document.body.innerHTML.slice(0, 200000) : ''; }
  return {
    meta: m,
    html: String(html || '').slice(0, 800000),
    images: images.slice(0, 250),
    imageCount: images.length,
    selectionText: (() => { try { return String(window.getSelection() || '').slice(0, 20000); } catch (e) { return ''; } })(),
    clipType
  };
})();
