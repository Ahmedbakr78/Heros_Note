# Contributing to markClipper

Thanks for helping. This is a zero-dependency, vanilla-JS side-panel extension — contributions stay that way.

## Ground rules

1. **Zero runtime dependencies.** Extend `clipper.js` rules; never import a Markdown/readability library.
2. **Panel-only.** Do not add a popup window. The panel is the product.
3. **Privacy first.** No telemetry, no remote code, no accounts, no network calls in app code.
4. **On-demand scripts only.** Content extraction stays injected-per-clip — no always-on content scripts.
5. **Design system.** Heros tokens: floating topbar, ultra-rounded cards, pill tabs, dark + light.

## Workflow

1. Fork + clone; branch `feat/…` or `fix/…`.
2. Load the folder unpacked while developing.
3. Manually test: article clip, selection clip, photo grab (a page with 50+ images), screenshot, library search, export `.md` + backup/restore, dark/light.
4. Update `CHANGELOG.md`; bump `manifest.json` version for user-facing changes.
5. Open a PR with the template; GIFs for UI changes welcome.

## What belongs here

- Extraction/conversion fidelity bugs
- Photo Lab accuracy (srcset, lazy attrs, dedupe)
- Library UX, export formats, accessibility, docs

## What does not belong

- Cloud sync services, accounts, analytics
- Bundled frameworks or build tooling
- Always-on content scripts

## Commits

`feat:` · `fix:` · `docs:` · `perf:` · `refactor:` — one logical change each.

## Conduct

[Contributor Covenant](./CODE_OF_CONDUCT.md).
