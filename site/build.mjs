#!/usr/bin/env node
// Builds the public site into _site/: an about page with the latest controller release and the
// module list, and one page per module in index.json. Release details come from the GitHub API,
// so the site is rebuilt on each push, each release, and once a day for module repos' releases.
//
//   node site/build.mjs            (GITHUB_TOKEN raises the API rate limit; optional)

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
<header class="top"><a class="brand" href="${up}./">Rack Control Surface</a><nav><a href="${up}./#modules">Modules</a><a href="${up}./#download">Download</a><a href="${up}./#publish">Publish a module</a></nav></header>
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

const about = `
<section class="hero">
  <h1>A rack-mount control surface for show infrastructure</h1>
  <p class="lead">Two rack units with a 1920 × 440 touchscreen and 15 LCD keys, running one app at a time: route a Videohub, watch an LED processor, check the network, drive Companion. It runs on a Raspberry Pi and is controlled at the rack or from a browser.</p>
</section>

<section class="grid3">
  <div><h3>One module at a time</h3><p>Each app is a module with the whole screen and all 15 keys. Home keeps it running in the background, and the unit resumes it after a power cut.</p></div>
  <div><h3>The device is in charge</h3><p>Modules read live state from the equipment they control. Starting, restoring or reconnecting never sends a command; only an operator's tap does.</p></div>
  <div><h3>From the rack or a browser</h3><p>The web view mirrors the panel, with more room for detail, and can be locked with a PIN.</p></div>
</section>

<section id="modules">
  <h2>Modules</h2>
  ${cards.length ? `<div class="cards">${cards.join('\n')}</div>` : '<p class="empty">No modules are listed yet. The first ones on the way: a Videohub router, an LED processor monitor, a UniFi network viewer and a Bitfocus Companion host.</p>'}
</section>

<section id="download">
  <h2>Download</h2>
  ${img ? `<p>SD card image for 64-bit Raspberry Pi boards, controller v${esc(img.asset.name.slice(4, -'-arm64.img.xz'.length))} (${date(img.r.published_at)}).</p>
  <p class="actions"><a class="button" href="${esc(img.asset.browser_download_url)}">Download ${esc(img.asset.name)} (${size(img.asset.size)})</a>${imgSum ? ` <a href="${esc(imgSum.browser_download_url)}">SHA-256</a>` : ''}</p>
  <p class="hint">Write it with Raspberry Pi Imager (Choose OS › Use custom). Its settings can add Wi-Fi. Once the unit boots, open <code>http://rack-surface.local/</code>.</p>` : '<p class="empty">The first SD card image is not out yet.</p>'}
  ${ctl ? `<p class="hint">Units already running update themselves from Settings › Updates. The latest controller is v${esc(ctl.asset.name.slice('rcs-controller-'.length, -'.tar.gz'.length))}; see <a href="https://github.com/${HERE}/releases">all releases</a>.</p>` : ''}
</section>

<section id="publish">
  <h2>Publish a module</h2>
  <ol>
    <li>Build your module and publish signed releases (<code>&lt;id&gt;-&lt;version&gt;.zip</code> and its <code>.zip.sig</code>) from its own GitHub repo.</li>
    <li>Open a pull request on <a href="https://github.com/${HERE}">${esc(HERE)}</a> that adds your module to <code>index.json</code> with your publisher key.</li>
    <li>Once it is merged, units list your module and see each new release as an update. This site adds a page for it.</li>
  </ol>
</section>`;
writeFileSync(path.join(OUT, 'index.html'), page('Rack Control Surface', about));
console.log(`built ${modules.length} module page(s) into ${path.relative(process.cwd(), OUT) || '.'}`);
