# Rack Control Surface releases

This public repo is what units read; the source is private. It holds:

- **Controller releases**: `rcs-controller-<version>.tar.gz` with its `.sig`, and the SD card image
  `rcs-<version>-arm64.img.xz`, published here by the source repo's release workflow. Units check these releases for
  controller updates and install only ones signed with the release key built into them.
- **The module index**, `index.json` below.
- **The public site**, built by `site/build.mjs` from `index.json` and the releases, and published with GitHub Pages
  (`.github/workflows/pages.yml`): an about page, architecture, usage, developer and theme pages, a page per module,
  and `llms.txt` (from `site/static/`), a summary for AI coding tools. It rebuilds on every push, every release here,
  and daily to pick up new releases in module repos.

## Module index

Units read `index.json` from the main branch of this repo to find modules. Each entry names a module once; its
versions come from the GitHub Releases of its own repo.

```json
{
  "id": "videohub-router",
  "name": "Videohub Router",
  "description": "Route sources to destinations on a Smart Videohub",
  "repo": "your-org/rcs-videohub-router",
  "publicKey": "ed25519:…"
}
```

- `id` must match `id` in the module's `module.json`.
- `publicKey` is what `rcs-pack keygen` printed. Each module has its own key. Units install only releases signed with this key, so changing
  it here is how a publisher rotates a lost or leaked key.
- A release needs `<id>-<version>.zip` and `<id>-<version>.zip.sig` as assets, a tag `v<version>`, and to be marked
  Latest. Drafts and pre-releases are ignored. Units read releases through the GitHub API; when its hourly limit is
  used up they read only `github.com/<repo>/releases/latest` and build the file names from its tag.
- Units check at boot and every 24 hours, show "Update available", and never install on their own.

Add or change an entry with a pull request. Whoever merges it decides which publisher key every unit trusts for that
module, so check that the key came from the module's owner.
