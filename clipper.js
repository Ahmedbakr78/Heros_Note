'use strict';
/* ==========================================================================
   markClipper engine — zero-dependency, offline, CSP-safe.
   Readability-lite + perfect Turndown-lite + frontmatter + filename + stats.
   Works in sidepanel (DOM) and is unit-testable in Node (pure string fns).
   ========================================================================== */
(function (root) {
  const MC = {};

  const WORDS_PER_MIN = 200;

  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function trim(s) { return (s || '').replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, ''); }
  function collapse(s) { return (s || '').replace(/[ \t\xA0\u1680\u2000-\u200A\u202F\u205F\u3000]+/g, ' '); }

  MC.wordCount = function (md) {
    const t = String(md || '');
    // CJK chars count as words
    const cjk = (t.match(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g) || []).length;
    const latin = trim(t.replace(/[#>*`~\-\[\]()!|]/g, ' ').replace(/[\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g, ' '))
      .split(/\s+/).filter(Boolean).length;
    return latin + cjk;
  };
  MC.readingTime = function (md) {
    const w = MC.wordCount(md);
    const m = Math.max(1, Math.round(w / WORDS_PER_MIN));
    return { words: w, minutes: m, label: m <= 1 ? '1 min read' : m + ' min read' };
  };
  MC.excerpt = function (md, n) {
    n = n || 160;
    const t = trim(String(md || '').replace(/^---[\s\S]*?---/, '').replace(/[#>*`\-+!\[\]()|]/g, '').replace(/\s+/g, ' '));
    return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
  };
  MC.slug = function (s) {
    return String(s || 'untitled').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0600-\u06ff]+/gi, '-')
      .replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'untitled';
  };
  MC.safeFilename = function (s) { return String(s || '').replace(/[\\/:*?"<>|#%&{}$!'@+=`~]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120); };

  MC.filenameFromTemplate = function (tpl, meta) {
    const d = meta.date ? new Date(meta.date) : new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const map = {
      '{title}': MC.safeFilename(meta.title || 'untitled'),
      '{slug}': MC.slug(meta.title || 'untitled'),
      '{site}': MC.safeFilename(meta.site || 'web'),
      '{date}': d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
      '{time}': pad(d.getHours()) + '-' + pad(d.getMinutes()),
      '{year}': String(d.getFullYear()),
      '{month}': pad(d.getMonth() + 1),
      '{day}': pad(d.getDate()),
      '{type}': meta.clipType || 'clip'
    };
    let out = String(tpl || '{date}-{slug}');
    for (const k of Object.keys(map)) out = out.split(k).join(map[k]);
    out = out.replace(/[\\/:*?"<>|]+/g, '-').trim();
    if (!/\.md$/i.test(out)) out += '.md';
    return out.slice(0, 140);
  };

  MC.buildFrontmatter = function (meta, opts) {
    opts = opts || {};
    if (opts.frontmatter === false) return '';
    const lines = ['---'];
    const q = (v) => {
      v = String(v == null ? '' : v);
      if (/[:#\[\]{},&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v) || v.includes('\n')) return JSON.stringify(v);
      return v === '' ? '""' : v;
    };
    if (opts.fmTitle !== false) lines.push('title: ' + q(meta.title || 'Untitled'));
    if (opts.fmSource !== false && meta.url) lines.push('source: ' + q(meta.url));
    if (opts.fmAuthor !== false && meta.author) lines.push('author: ' + q(meta.author));
    if (opts.fmDate !== false) lines.push('date: ' + q(meta.dateISO || new Date(meta.date || Date.now()).toISOString()));
    if (opts.fmSite !== false && meta.site) lines.push('site: ' + q(meta.site));
    if (opts.fmType !== false) lines.push('type: ' + q(meta.clipType || 'article'));
    if (opts.fmTags !== false && meta.tags && meta.tags.length) lines.push('tags: [' + meta.tags.map(q).join(', ') + ']');
    if (opts.fmExcerpt !== false && meta.excerpt) lines.push('excerpt: ' + q(meta.excerpt));
    if (opts.fmWords !== false) lines.push('words: ' + (meta.words || 0));
    if (opts.fmReading !== false) lines.push('reading_time: ' + q(meta.reading || '1 min read'));
    if (meta.description && opts.fmDesc !== false) lines.push('description: ' + q(meta.description));
    lines.push('---', '');
    // drop empty shell
    if (lines.length <= 3) return '';
    return lines.join('\n');
  };

  MC.wrapDocument = function (bodyMd, meta, opts) {
    opts = opts || {};
    const fm = MC.buildFrontmatter(meta, opts);
    let head = '';
    if (opts.titleHeading !== false && meta.title) head = '# ' + String(meta.title).replace(/\n+/g, ' ') + '\n\n';
    let src = '';
    if (opts.sourceLine !== false && meta.url) src = '> Source: [' + (meta.site || meta.url) + '](' + meta.url + ')' + (meta.author ? ' — ' + meta.author : '') + '\n\n';
    let tags = '';
    if (opts.tagsLine !== false && meta.tags && meta.tags.length) tags = meta.tags.map((t) => '#' + String(t).replace(/\s+/g, '-')).join(' ') + '\n\n';
    return (fm + head + src + String(bodyMd || '').replace(/\n{3,}/g, '\n\n').trim() + '\n' + (tags ? '\n' + tags : '')).trim() + '\n';
  };

  /* ---------------- HTML -> Markdown (Turndown-lite, perfect) ---------------- */
  const BLOCKS = { P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, HEADER: 1, FOOTER: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, PRE: 1, TABLE: 1, HR: 1, FIGURE: 1, FIGCAPTION: 1 };

  function nodeText(node) { return node ? (node.textContent || '') : ''; }

  function absUrl(url, base) {
    if (!url) return '';
    url = trim(url);
    if (/^(https?:|mailto:|tel:|data:|#)/i.test(url)) return url;
    try { return new URL(url, base || 'https://x/').href; } catch (e) { return url; }
  }

  MC.absolutize = function (rootEl, base) {
    try {
      rootEl.querySelectorAll('a[href]').forEach((a) => { try { a.setAttribute('href', absUrl(a.getAttribute('href'), base)); } catch (e) {} });
      rootEl.querySelectorAll('img[src]').forEach((img) => { try { img.setAttribute('src', absUrl(img.getAttribute('src'), base)); } catch (e) {} });
      rootEl.querySelectorAll('source[srcset],img[srcset]').forEach((el) => {
        try {
          const ss = el.getAttribute('srcset'); if (!ss) return;
          const first = ss.split(',')[0].trim().split(' ')[0];
          el.setAttribute('src', absUrl(first, base));
        } catch (e) {}
      });
    } catch (e) {}
  };

  function mdEscapeText(s) {
    return String(s || '').replace(/\\/g, '\\\\').replace(/([*_`\[\]])/g, '\\$1');
  }

  function cells(row) {
    const out = [];
    row.querySelectorAll(':scope > th, :scope > td').forEach((c) => out.push(c));
    return out;
  }

  function convertNode(node, opts, ctx) {
    if (!node) return '';
    if (node.nodeType === 3) {
      // collapse but keep meaningful spaces
      const v = node.nodeValue || '';
      if (!trim(v)) return ' ';
      return collapse(v).replace(/\n+/g, ' ');
    }
    if (node.nodeType !== 1) return '';
    const tag = (node.tagName || 'X').toUpperCase();
    const o = opts || {};
    ctx = ctx || { listDepth: 0, quote: 0, li: false };

    function kids(n, c2) { let s = ''; n.childNodes.forEach((ch) => { s += convertNode(ch, o, c2 || ctx); }); return s; }
    function block(s) { s = String(s || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); return s ? s + '\n\n' : ''; }

    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE' || tag === 'SVG') return '';
    if (node.classList && (node.classList.contains('mc-remove'))) return '';

    if (/^H[1-6]$/.test(tag)) {
      const lvl = Math.min(6, Math.max(1, parseInt(tag[1], 10) + (o.headingOffset || 0)));
      return block('#'.repeat(lvl) + ' ' + trim(kids(node)).replace(/\n+/g, ' '));
    }
    if (tag === 'P' || tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'HEADER' || tag === 'FOOTER' || tag === 'FIGURE' || tag === 'FIGCAPTION' || tag === 'ASIDE' && false) {
      return block(kids(node));
    }
    if (tag === 'BR') return '  \n';
    if (tag === 'HR') return '---\n\n';
    if (tag === 'STRONG' || tag === 'B') { const t = trim(kids(node)); return t ? '**' + t + '**' : ''; }
    if (tag === 'EM' || tag === 'I') { const t = trim(kids(node)); return t ? '*' + t + '*' : ''; }
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') { const t = trim(kids(node)); return t ? '~~' + t + '~~' : ''; }
    if (tag === 'U') { const t = trim(kids(node)); return t ? '<u>' + t + '</u>' : ''; }
    if (tag === 'MARK') { const t = trim(kids(node)); return t ? '==' + t + '==' : ''; }
    if (tag === 'CODE') {
      const t = nodeText(node).replace(/\n+/g, ' ');
      if (!trim(t)) return '';
      // inside PRE handled separately
      if (node.parentElement && node.parentElement.tagName === 'PRE') return t;
      return '`' + t.replace(/`/g, "'") + '`';
    }
    if (tag === 'PRE') {
      let lang = '';
      const code = node.querySelector('code');
      if (code && code.className) { const m = code.className.match(/language-([\w+-]+)/); if (m) lang = m[1]; }
      const raw = nodeText(node).replace(/\n\s*\n\s*\n/g, '\n\n');
      return '```' + lang + '\n' + trim(raw) + '\n```\n\n';
    }
    if (tag === 'A') {
      const href = node.getAttribute('href') || '';
      const t = trim(kids(node)) || trim(node.getAttribute('title') || '') || href;
      if (!href || href === '#') return t;
      if (o.linkStyle === 'footnote') return t + '[^' + (ctx.fn ? ++ctx.fnN : 1) + ']';
      if (o.stripLinks) return t;
      // autolink bare urls
      if (t === href) return '<' + href + '>';
      return '[' + t.replace(/\n+/g, ' ').replace(/\]/g, '\\]') + '](' + href.replace(/\)/g, '%29') + (node.title ? ' "' + node.title.replace(/"/g, "'") + '"' : '') + ')';
    }
    if (tag === 'IMG') {
      if (o.stripImages) return node.getAttribute('alt') || '';
      const src = node.getAttribute('src') || '';
      if (!src || src.startsWith('data:') && o.skipDataImages) return node.getAttribute('alt') || '';
      const alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      return '![' + alt + '](' + src.replace(/\)/g, '%29') + ')';
    }
    if (tag === 'PICTURE' || tag === 'SOURCE') return kids(node);
    if (tag === 'BLOCKQUOTE') {
      const inner = trim(kids(node, { listDepth: ctx.listDepth, quote: ctx.quote + 1, li: ctx.li }));
      if (!inner) return '';
      // callout [!NOTE] passthrough
      return block(inner.split('\n').map((l) => '> ' + l).join('\n'));
    }
    if (tag === 'UL' || tag === 'OL') {
      const c2 = { listDepth: ctx.listDepth + 1, quote: ctx.quote, li: false };
      let i = 0; let s = '';
      node.childNodes.forEach((ch) => {
        if (ch.nodeType === 1 && ch.tagName === 'LI') { i++; s += convertNode(ch, o, { listDepth: c2.listDepth, quote: ctx.quote, li: true, olIndex: i, ordered: tag === 'OL' }); }
      });
      return (ctx.li ? '\n' : '') + s + (ctx.li ? '' : '\n');
    }
    if (tag === 'LI') {
      const indent = '  '.repeat(Math.max(0, ctx.listDepth - 1));
      const marker = ctx.ordered ? (ctx.olIndex || 1) + '. ' : '- ';
      // task lists
      const cb = node.querySelector(':scope > input[type="checkbox"]');
      let prefix = marker;
      if (cb) prefix = '- [' + (cb.checked ? 'x' : ' ') + '] ';
      let s = '';
      node.childNodes.forEach((ch) => {
        if (ch.nodeType === 1 && ch.tagName === 'INPUT' && ch.type === 'checkbox') return;
        s += convertNode(ch, o, { listDepth: ctx.listDepth, quote: ctx.quote, li: false });
      });
      s = trim(s).replace(/\n+/g, '\n' + indent + '  ');
      return indent + prefix + s + '\n';
    }
    if (tag === 'TABLE') {
      try {
        const rows = Array.from(node.querySelectorAll('tr'));
        if (!rows.length) return block(kids(node));
        const head = cells(rows[0]).map((c) => trim(nodeText(c)).replace(/\|/g, '\\|').replace(/\n+/g, ' ') || ' ');
        const aligns = cells(rows[0]).map((c) => {
          const a = (c.getAttribute('align') || c.style.textAlign || '').toLowerCase();
          if (a === 'center') return ':---:';
          if (a === 'right') return '---:';
          return '---';
        });
        let out = '| ' + head.join(' | ') + ' |\n| ' + aligns.join(' | ') + ' |\n';
        for (let r = 1; r < rows.length; r++) {
          const tds = cells(rows[r]).map((c) => trim(convertNode(c, o, ctx)).replace(/\|/g, '\\|').replace(/\n+/g, '<br>'));
          while (tds.length < head.length) tds.push('');
          out += '| ' + tds.join(' | ') + ' |\n';
        }
        return out + '\n';
      } catch (e) { return block(kids(node)); }
    }
    if (tag === 'TR' || tag === 'TD' || tag === 'TH' || tag === 'TBODY' || tag === 'THEAD') return kids(node) + ' ';
    if (tag === 'DETAILS') {
      const sum = node.querySelector(':scope > summary');
      const t = sum ? trim(nodeText(sum)) : 'Details';
      node.querySelectorAll('summary').forEach(() => {});
      return block('<details>\n<summary>' + t + '</summary>\n\n' + trim(kids(node)) + '\n</details>');
    }
    if (tag === 'SUMMARY') return '';
    if (tag === 'FIGURE') return block(kids(node));
    if (tag === 'IFRAME' || tag === 'VIDEO' || tag === 'AUDIO' || tag === 'CANVAS') {
      const src = node.getAttribute('src') || '';
      return src ? block('[Embedded media](' + src + ')') : '';
    }
    // default inline vs block
    if (BLOCKS[tag]) return block(kids(node));
    return kids(node);
  }

  MC.htmlToMarkdown = function (html, opts, baseUrl) {
    opts = opts || {};
    const doc = document.implementation.createHTMLDocument('mc');
    doc.documentElement.innerHTML = '<body>' + String(html || '') + '</body>';
    MC.absolutize(doc.body, baseUrl || document.baseURI);
    // pre-clean
    doc.body.querySelectorAll('script,style,noscript,template,svg,.ad,.ads,.advertisement').forEach((el) => el.remove());
    let md = convertNode(doc.body, opts, { listDepth: 0, quote: 0, li: false, fnN: 0 });
    md = md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (opts.tidy !== false) {
      // fix spaced emphasis artifacts
      md = md.replace(/\*\*\s+\*\*/g, '').replace(/``/g, '');
    }
    return md;
  };

  /* ---------------- Readability-lite: pick main content ---------------- */
  const UNLIKELY = /combx|comment|community|disqus|extra|foot|header|menu|remark|rss|shoutbox|sidebar|sponsor|ad-break|agegate|pagination|pager|popup|tweet|twitter|social|modal|overlay|cookie|consent|newsletter|subscribe|related|recommend|share|toolbar|dropdown|login|signin|promo|banner|nav/i;
  const LIKELY = /and|article|body|column|main|shadow|content|post|story|entry|text|blog|page/i;

  MC.pickMainNode = function (doc) {
    doc = doc || document;
    const sel = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content', '#content'];
    for (const s of sel) {
      try {
        const el = doc.querySelector(s);
        if (el && (el.innerText || '').trim().length > 400) return el;
      } catch (e) {}
    }
    // score paragraphs' parents
    const paras = Array.from(doc.querySelectorAll('p, pre, blockquote, li, h1, h2'));
    const scores = new Map();
    const boost = (el, n) => { if (!el || el === doc.body || el === doc.documentElement) return; scores.set(el, (scores.get(el) || 0) + n); };
    for (const p of paras) {
      const txt = (p.innerText || '').trim();
      if (txt.length < 80) continue;
      let commas = (txt.match(/,/g) || []).length;
      let score = Math.min(6, Math.floor(txt.length / 220)) + Math.min(3, commas);
      let el = p.parentElement;
      for (let d = 0; d < 3 && el; d++) {
        const cls = (el.className || '') + ' ' + (el.id || '');
        if (UNLIKELY.test(cls) && !LIKELY.test(cls)) score -= 3;
        if (LIKELY.test(cls)) score += 2;
        boost(el, score);
        el = el.parentElement;
      }
    }
    let best = null, bestScore = 8;
    for (const [el, sc] of scores) { if (sc > bestScore) { bestScore = sc; best = el; } }
    return best || doc.body;
  };

  MC.cleanClone = function (node, opts) {
    opts = opts || {};
    const clone = node.cloneNode(true);
    const killSel = ['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'form', 'button', 'input', 'select', 'textarea',
      'nav', '.nav', '.navbar', '.menu', '.sidebar', '.widget', '.comments', '#comments', '.comment', '.ad', '.ads', '.advertisement',
      '.share', '.sharing', '.social', '.newsletter', '.subscribe', '.related', '.recommendations', '.popup', '.modal', '.cookie', '.consent', '.toolbar', 'footer'];
    if (opts.aggressive !== false) killSel.push('header', '.header', 'aside', '.aside', '.promo', '.banner');
    killSel.forEach((s) => { try { clone.querySelectorAll(s).forEach((el) => el.remove()); } catch (e) {} });
    // drop hidden + tiny
    clone.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((el) => el.remove());
    // unwrap font/div spans noise
    clone.querySelectorAll('font').forEach((f) => { const sp = document.createElement('span'); sp.innerHTML = f.innerHTML; f.replaceWith(sp); });
    // remove style/onclick
    clone.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('style'); el.removeAttribute('onclick'); el.removeAttribute('onload');
      if (el.getAttribute('href') === '#') el.removeAttribute('href');
    });
    return clone;
  };

  /* ---------------- tiny Markdown preview (GFM-lite) ---------------- */
  function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  MC.mdToHtml = function (md) {
    md = String(md || '');
    // strip frontmatter
    md = md.replace(/^---\n[\s\S]*?\n---\n?/, '');
    // code fences first
    const codes = [];
    md = md.replace(/```(\w*)\n([\s\S]*?)(```|$)/g, (m, lang, code) => {
      codes.push('<pre class="md-pre"><code>' + escHtml(code.replace(/\n$/, '')) + '</code></pre>');
      return '\u0000CODE' + (codes.length - 1) + '\u0000';
    });
    md = escHtml(md);
    // headings
    md = md.replace(/^###### (.*)$/gm, '<h6>$1</h6>').replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>').replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>');
    md = md.replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>').replace(/<\/blockquote>\n<blockquote>/g, '<br>');
    md = md.replace(/^---$/gm, '<hr>').replace(/^\- \[( |x)\] (.*)$/gm, '<div class="md-task">$2</div>');
    md = md.replace(/^\- (.*)$/gm, '<li>$1</li>').replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
    md = md.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    md = md.replace(/\|(.+)\|/g, (m) => '<div class="md-row">' + escHtml(m) + '</div>');
    // inline
    md = md.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/~~([^~]+)~~/g, '<del>$1</del>')
      .replace(/==([^=]+)==/g, '<mark>$1</mark>').replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)"]+)(?:\s+"([^"]*)")?\)/g, '<figure class="md-img"><img src="$2" alt="$1" loading="lazy"><figcaption>$1</figcaption></figure>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    // paragraphs
    md = md.split(/\n{2,}/).map((blk) => {
      if (/^\u0000CODE\d+\u0000$/.test(blk.trim())) return blk;
      if (/^<(h\d|ul|ol|li|blockquote|hr|pre|div)/.test(blk.trim())) return blk;
      return blk.trim() ? '<p>' + blk.replace(/\n/g, '<br>') + '</p>' : '';
    }).join('\n');
    md = md.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => codes[Number(i)] || '');
    return md;
  };

  /* ---------------- PHOTO LAB — images to perfect Markdown ---------------- */
  MC.filterImages = function (images, opts) {
    opts = opts || {};
    const minW = opts.minW != null ? opts.minW : 80;
    const minH = opts.minH != null ? opts.minH : 60;
    return (images || []).filter((im) => {
      if (!im || !im.src) return false;
      if (opts.skipData !== false && /^data:/i.test(im.src)) return false;
      if (opts.skipIcons !== false) {
        const s = im.src.toLowerCase();
        if (/(icon|logo|avatar|sprite|favicon|badge|emoji|spinner|loader|pixel|tracking|1x1)/.test(s)) {
          // keep only if reasonably large
          if ((im.w || 0) < 200) return false;
        }
        if ((im.w || 0) < minW && (im.h || 0) < minH && (im.w || im.h)) return false;
      }
      if (opts.onlyPhotos && (im.w || 0) < 300) return false;
      return true;
    });
  };
  MC.imageMarkdown = function (im, i) {
    const alt = String((im && im.alt) || 'photo-' + ((i || 0) + 1)).replace(/[\[\]]/g, '').slice(0, 120) || ('photo-' + ((i || 0) + 1));
    const src = String((im && im.src) || '');
    const title = im && im.title ? ' "' + String(im.title).replace(/"/g, "'").slice(0, 80) + '"' : '';
    const dims = im && (im.w || im.h) ? ' <!-- ' + (im.w || '?') + 'x' + (im.h || '?') + ' -->' : '';
    return '![' + alt + '](' + src.replace(/\)/g, '%29') + title + ')' + dims;
  };
  MC.galleryMarkdown = function (images, meta, opts) {
    opts = opts || {};
    images = images || [];
    const perRow = 1;
    let out = '';
    images.forEach((im, i) => {
      const cap = im.alt ? '\n*' + String(im.alt).slice(0, 160) + '*' : '';
      out += '### Photo ' + (i + 1) + '\n\n' + MC.imageMarkdown(im, i) + cap + '\n\n';
      if (opts.withSource && meta && meta.url) out += '[Open original](' + im.src + ')\n\n';
    });
    return out.trim() + '\n';
  };
  MC.countImagesInMarkdown = function (md) {
    return ((String(md || '').match(/!\[[^\]]*\]\(/g) || []).length);
  };
  MC.guessImageName = function (src, i, site) {
    let ext = 'jpg';
    try {
      const u = new URL(src);
      const m = u.pathname.match(/\.(jpe?g|png|gif|webp|avif|svg|bmp)(\?|$)/i);
      if (m) ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    } catch (e) {}
    if (/^data:image\/(png|jpeg|jpg|gif|webp)/i.test(src)) {
      const m2 = src.match(/^data:image\/(png|jpeg|jpg|gif|webp)/i);
      if (m2) ext = m2[1].toLowerCase().replace('jpeg', 'jpg');
    }
    return 'markclipper-' + (site || 'web').replace(/[^a-z0-9]+/gi, '').slice(0, 16) + '-photo-' + String(i + 1).padStart(2, '0') + '.' + ext;
  };

  /* ---------------- templates ---------------- */
  MC.TEMPLATES = {
    article: { name: 'Article', desc: 'Title + source + clean body', opts: {} },
    notes: { name: 'Study notes', desc: 'H2 sections + key points box', opts: { studyBox: true } },
    bookmark: { name: 'Bookmark', desc: 'Title + URL + tags only', opts: { body: 'bookmark' } },
    minimal: { name: 'Minimal', desc: 'No frontmatter, body only', opts: { frontmatter: false, titleHeading: false, sourceLine: false } },
    quote: { name: 'Quote pack', desc: 'Body as blockquotes', opts: { asQuote: true } }
  };

  root.MarkClipper = MC;
})(typeof window !== 'undefined' ? window : globalThis);
