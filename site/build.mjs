#!/usr/bin/env node
// Builds the public site into _site/: the pages in site/pages (overview, architecture, usage,
// develop, themes) and the files in site/static, with the module list and downloads filled in, and one page per module in index.json. Release details come from the GitHub API,
// so the site is rebuilt on each push, each release, and once a day for module repos' releases.
//
//   node site/build.mjs            (GITHUB_TOKEN raises the API rate limit; optional)

import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const HERE = process.env.GITHUB_REPOSITORY ?? 'horinezachary/rcs-releases';
const API = 'https://api.github.com';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : '');
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const safeId = (id) => /^[a-z0-9][a-z0-9-]*$/.test(id);

async function releases(repo) {
  const headers = { accept: 'application/vnd.github.html+json', 'user-agent': 'rcs-site' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`${API}/repos/${repo}/releases?per_page=20`, { headers });
  if (!res.ok) {
    console.warn(`${repo}: HTTP ${res.status}`);
    return [];
  }
  return (await res.json()).filter((r) => !r.draft && !r.prerelease);
}

/** The newest release that carries an asset matching `test`, with that asset. */
function newest(list, test) {
  for (const r of list) {
    const asset = r.assets.find((a) => test(a.name));
    if (asset) return { r, asset };
  }
  return null;
}

const page = (title, body, depth = 0) => {
  const up = depth ? '../'.repeat(depth) : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="${up}style.css">
</head>
<body>
<header class="top"><a class="brand" href="${up}./">Rack Control Surface</a><nav><a href="${up}architecture/">Architecture</a><a href="${up}usage/">Using it</a><a href="${up}develop/">Develop</a><a href="${up}themes/">Themes</a><a href="${up}./#modules">Modules</a><a href="${up}./#download">Download</a></nav></header>
<main>
${body}
</main>
<footer>Releases are signed; units install only what checks out against the key they trust. <a href="https://github.com/${HERE}">${esc(HERE)}</a></footer>
</body>
</html>
`;
};

const index = JSON.parse(readFileSync(path.join(ROOT, 'index.json'), 'utf8'));
const modules = (index.modules ?? []).filter((m) => {
  if (!safeId(m.id)) console.warn(`skipping module with unusable id ${JSON.stringify(m.id)}`);
  return safeId(m.id);
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
copyFileSync(path.join(ROOT, 'site', 'style.css'), path.join(OUT, 'style.css'));
// Files served as they are, such as the theme schema and example.
for (const f of readdirSync(path.join(ROOT, 'site', 'static'))) copyFileSync(path.join(ROOT, 'site', 'static', f), path.join(OUT, f));
writeFileSync(path.join(OUT, '.nojekyll'), '');

// Module pages.
const cards = [];
for (const m of modules) {
  const list = await releases(m.repo);
  const latest = newest(list, (n) => n.startsWith(`${m.id}-`) && n.endsWith('.zip'));
  const sig = latest && latest.r.assets.find((a) => a.name === `${latest.asset.name}.sig`);
  const version = latest && latest.asset.name.slice(m.id.length + 1, -'.zip'.length);
  const history = list
    .map((r) => newest([r], (n) => n.startsWith(`${m.id}-`) && n.endsWith('.zip')))
    .filter(Boolean)
    .slice(0, 10);

  cards.push(`<a class="card" href="modules/${m.id}/"><h3>${esc(m.name)}</h3><p>${esc(m.description)}</p><span class="meta">${version ? `v${esc(version)} · ${date(latest.r.published_at)}` : 'No release yet'}</span></a>`);

  const body = `
<p class="crumb"><a href="../../#modules">Modules</a></p>
<h1>${esc(m.name)}</h1>
<p class="lead">${esc(m.description)}</p>
<section class="panel">
  <dl>
    <dt>Latest</dt><dd>${version ? `v${esc(version)}, ${date(latest.r.published_at)}` : 'No signed release yet'}</dd>
    <dt>Source</dt><dd><a href="https://github.com/${esc(m.repo)}">${esc(m.repo)}</a></dd>
    <dt>Module id</dt><dd><code>${esc(m.id)}</code></dd>
    <dt>Publisher key</dt><dd><code class="key">${esc(m.publicKey)}</code></dd>
  </dl>
  ${latest ? `<p class="actions"><a class="button" href="${esc(latest.asset.browser_download_url)}">Download ${esc(latest.asset.name)}</a>${sig ? ` <a href="${esc(sig.browser_download_url)}">signature</a>` : ''}</p>` : ''}
  <p class="hint">On a unit, open Settings › Modules to install or update it. A zip can also be uploaded in the web view, together with its <code>.sig</code>.</p>
</section>
${latest?.r.body_html ? `<section><h2>What's new in v${esc(version)}</h2><div class="notes">${latest.r.body_html}</div></section>` : ''}
${history.length > 1 ? `<section><h2>Releases</h2><table><thead><tr><th>Version</th><th>Date</th><th>Download</th></tr></thead><tbody>${history
    .map(({ r, asset }) => `<tr><td>${esc(asset.name.slice(m.id.length + 1, -4))}</td><td>${date(r.published_at)}</td><td><a href="${esc(asset.browser_download_url)}">${size(asset.size)}</a></td></tr>`)
    .join('')}</tbody></table></section>` : ''}`;
  mkdirSync(path.join(OUT, 'modules', m.id), { recursive: true });
  writeFileSync(path.join(OUT, 'modules', m.id, 'index.html'), page(`${m.name} · Rack Control Surface`, body, 2));
}

// About page.
const own = await releases(HERE);
const ctl = newest(own, (n) => /^rcs-controller-.+\.tar\.gz$/.test(n));
const img = newest(own, (n) => /^rcs-.+-arm64\.img\.xz$/.test(n));
const imgSum = img && img.r.assets.find((a) => a.name === `${img.asset.name}.sha256`);

const fill = {
  modules: cards.length
    ? `<div class="cards">${cards.join('\n')}</div>`
    : '<p class="empty">No modules are listed yet. The first ones on the way: a video router, an LED processor monitor, a network viewer and a Bitfocus Companion host. <a href="develop/">Build your own</a>.</p>',
  download: img
    ? `<p>SD card image for 64-bit Raspberry Pi boards, controller v${esc(img.asset.name.slice(4, -'-arm64.img.xz'.length))} (${date(img.r.published_at)}).</p>
  <p class="actions"><a class="button" href="${esc(img.asset.browser_download_url)}">Download ${esc(img.asset.name)} (${size(img.asset.size)})</a>${imgSum ? ` <a href="${esc(imgSum.browser_download_url)}">SHA-256</a>` : ''}</p>
  <p class="hint">Write it with Raspberry Pi Imager (Choose OS › Use custom). Its settings can add Wi-Fi. Once the unit boots, open <code>http://rack-surface.local/</code>.</p>${
    ctl ? `<p class="hint">Units already running update themselves from Settings › Updates. The latest controller is v${esc(ctl.asset.name.slice('rcs-controller-'.length, -'.tar.gz'.length))}; see <a href="https://github.com/${HERE}/releases">all releases</a>.</p>` : ''}`
    : '<p class="empty">The first SD card image is not out yet.</p>'
};

const PAGES = path.join(ROOT, 'site', 'pages');
for (const file of readdirSync(PAGES).filter((f) => f.endsWith('.html'))) {
  const src = readFileSync(path.join(PAGES, file), 'utf8');
  const title = /<!--\s*title:\s*(.+?)\s*-->/.exec(src)?.[1] ?? 'Rack Control Surface';
  const body = src.replace(/<!--[\s\S]*?-->\n?/, '').replace(/\{\{(\w+)\}\}/g, (_, k) => fill[k] ?? '');
  const name = file.replace(/\.html$/, '');
  const dir = name === 'index' ? OUT : path.join(OUT, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'index.html'), page(name === 'index' ? title : `${title} · Rack Control Surface`, body, name === 'index' ? 0 : 1));
}
console.log(`built ${modules.length} module page(s) into ${path.relative(process.cwd(), OUT) || '.'}`);
