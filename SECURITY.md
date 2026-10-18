# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.1.x | ✅ |
| 1.0.x | ⚠️ upgrade recommended |
| < 1.0 | ❌ |

## Reporting a vulnerability

Do **not** open a public issue. Use
[GitHub security advisories](https://github.com/Ahmedbakr78/Heros_Note/security/advisories/new)
or contact the maintainer privately via [LinkedIn](https://www.linkedin.com/in/ahmed-abo-bakr-1b2466288/).

Acknowledge target: 7 days.

## Threat model summary

| Surface | Mitigation |
|---|---|
| Extension CSP | `script-src 'self'` — no inline/remote scripts |
| Content scripts | None always-on; `content-extract.js` injected per user action only |
| Clipped HTML | Sanitized before Markdown conversion (`on*`, `javascript:` stripped) |
| Clipboard / downloads | Explicit user action only via `chrome.downloads` |
| Network | App code makes zero network requests |
| Data | `chrome.storage.local` only; backups are user-owned JSON files |
