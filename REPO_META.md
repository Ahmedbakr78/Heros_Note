# REPO_META — GitHub About, topics, website, release setup for markClipper (Heros Note)

Copy-paste source of truth. Nothing here is code; it configures the GitHub page.

## 1. Repository

| Field | Value |
|---|---|
| Owner | `Ahmedbakr78` |
| Name | `Heros_Note` |
| Product name | markClipper |
| URL | `https://github.com/Ahmedbakr78/Heros_Note` |
| Visibility | Public |
| License | MIT (`LICENSE`) |
| Default branch | `main` |
| Website (Pages) | `https://ahmedbakr78.github.io/Heros_Note/` |
| Load-unpacked folder | repository root (contains `manifest.json`) |

## 2. About box

**Description (paste exactly, no emojis, 1 line):**

```text
markClipper — Markdown web clipper + photo lab. Save articles, selections, bookmarks, screenshots and 250-photo galleries to perfect Markdown notes. Panel-only, 100% local, free and unlimited.
```

**Website (paste exactly):**

```text
https://ahmedbakr78.github.io/Heros_Note/
```

Check: `Include in the home page` ON.

## 3. Topics (max 20)

```text
markdown, web-clipper, chrome-extension, manifest-v3, side-panel, offline-first, privacy, free, open-source, note-taking, readability, screenshot, photo-gallery, obsidian, yaml-frontmatter, dark-mode, javascript, zero-dependencies, productivity, clipper
```

```bash
gh repo edit Ahmedbakr78/Heros_Note \
  --add-topic markdown --add-topic web-clipper \
  --add-topic chrome-extension --add-topic manifest-v3 \
  --add-topic side-panel --add-topic offline-first \
  --add-topic privacy --add-topic free --add-topic open-source \
  --add-topic note-taking --add-topic readability \
  --add-topic screenshot --add-topic photo-gallery \
  --add-topic obsidian --add-topic yaml-frontmatter \
  --add-topic dark-mode --add-topic javascript \
  --add-topic zero-dependencies --add-topic productivity \
  --add-topic clipper
```

## 4. Website (GitHub Pages from `docs/`)

```bash
# Settings → Pages → Deploy from branch → main → /docs → Save
```

## 5. Social preview

Upload `docs/assets/icons/logo.png`.

## 6. Release v1.1.0

| Field | Value |
|---|---|
| Tag | `v1.1.0` |
| Title | `v1.1.0 — Photo Lab max power` |
| Asset | `markclipper-v1.1.0.zip` |

```bash
gh release create v1.1.0 markclipper-v1.1.0.zip \
  --title "v1.1.0 — Photo Lab max power" \
  --notes-file .github/RELEASE_v1.1.0.md
```

## 7. Repo settings checklist

- [x] Description + website in About
- [x] 20 topics
- [x] Pages from `main` + `/docs`
- [x] Issues + templates
- [x] MIT LICENSE
- [x] Release v1.1.0 with zip
- [x] No secrets / personal files
