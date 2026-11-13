#!/usr/bin/env node
'use strict';

/**
 * Projekt-Hub — local dashboard for all project folders on H:\ (and other roots).
 * Zero dependencies: Node >= 18 built-ins only. Binds to 127.0.0.1 only.
 */

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { APP_DIR, resolveConfigPath, loadConfig, saveConfig, applyUpdate } = require('./lib/config');
const { scan, inspectProject, readmeExcerpt } = require('./lib/scanner');
const { gitDetail } = require('./lib/git');
const actions = require('./lib/actions');
const sync = require('./lib/sync');
const { run, readJson, writeJson, isDir, driveLabel } = require('./lib/util');

const VERSION = '1.0.0';
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const NAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._()-]{0,63}$/u;
const RESERVED_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function parseArgs(argv) {
  const args = { open: false, noSync: false, config: null, port: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--open') args.open = true;
    else if (a === '--no-sync') args.noSync = true;
    else if (a === '--config') args.config = argv[++i];
    else if (a === '--port') args.port = Number(argv[++i]);
  }
  return args;
}

function createHub({ configPath, port, noSync = false, quiet = false } = {}) {
  const cfgPath = resolveConfigPath(configPath);
  let cfg = loadConfig(cfgPath);
  if (Number.isInteger(port)) cfg.port = port;
  const token = crypto.randomBytes(24).toString('hex');

  const hub = {
    data: { roots: cfg.roots.map((r) => ({ path: r, label: driveLabel(r), online: isDir(r), count: 0 })), projects: [], scannedAt: null, scanMs: 0 },
    github: { available: null, authed: false, user: null, repos: [], missing: [], error: null, fetchedAt: null },
    busy: { scanning: false, syncing: false, progress: null },
    lastSync: null,
    version: 1,
  };
  let scanPromise = null;
  let syncPromise = null;
  const timers = [];

  // ---------- logging & cache (cache lives on H:\DevCache\projekt-hub by default) ----------
  const cacheFile = () => path.join(cfg.cacheDir, 'scan-cache.json');
  const logFile = () => path.join(cfg.cacheDir, 'server.log');
  function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    if (!quiet) console.log(line);
    try {
      fs.mkdirSync(cfg.cacheDir, { recursive: true });
      const f = logFile();
      if (fs.existsSync(f) && fs.statSync(f).size > 1_000_000) fs.renameSync(f, `${f}.1`);
      fs.appendFileSync(f, line + '\n');
    } catch {
      /* cache drive missing: logging to console only */
    }
  }
  function loadCache() {
    const c = readJson(cacheFile(), 32 * 1024 * 1024);
    if (!c || !Array.isArray(c.projects) || JSON.stringify(c.rootsConfig) !== JSON.stringify(cfg.roots)) return;
    hub.data = { roots: c.roots, projects: c.projects, scannedAt: c.scannedAt, scanMs: c.scanMs, fromCache: true };
    if (Array.isArray(c.githubRepos)) hub.github.repos = c.githubRepos;
    hub.version++;
  }
  function saveCache() {
    try {
      writeJson(cacheFile(), { ...hub.data, rootsConfig: cfg.roots, githubRepos: hub.github.repos, fromCache: undefined });
    } catch (err) {
      log(`Cache nicht schreibbar (${cfg.cacheDir}): ${err.message}`);
    }
  }
  const bump = () => {
    hub.version++;
  };
  const findProject = (id) => hub.data.projects.find((p) => p.id === id);

  function recomputeMissing() {
    hub.github.missing = hub.github.authed ? sync.missingRepos(hub.github.repos, hub.data.projects) : [];
  }

  // ---------- core jobs ----------
  function scanNow() {
    if (scanPromise) return scanPromise;
    hub.busy.scanning = true;
    bump();
    scanPromise = scan(cfg)
      .then((data) => {
        hub.data = data;
        recomputeMissing();
        saveCache();
        log(`Scan: ${data.projects.length} Projekte in ${data.scanMs} ms`);
      })
      .catch((err) => log(`Scan fehlgeschlagen: ${err.stack || err}`))
      .finally(() => {
        hub.busy.scanning = false;
        scanPromise = null;
        bump();
      });
    return scanPromise;
  }

  async function refreshGithub() {
    try {
      const st = await sync.githubStatus();
      Object.assign(hub.github, st, { error: null });
      if (st.authed) {
        hub.github.repos = await sync.listGithubRepos(cfg);
        hub.github.fetchedAt = Date.now();
      }
      recomputeMissing();
    } catch (err) {
      hub.github.error = err.message;
      log(`GitHub: ${err.message}`);
    }
    bump();
  }

  function runSync() {
    if (syncPromise) return syncPromise;
    hub.busy.syncing = true;
    hub.busy.progress = 'Starte …';
    bump();
    syncPromise = (async () => {
      const summary = { at: null, fetched: 0, pulled: 0, cloned: [], errors: [] };
      const results = await sync.syncAll(hub.data.projects, cfg, (done, total, name) => {
        hub.busy.progress = `${done}/${total} · ${name}`;
        bump();
      });
      for (const r of results) {
        if (r.fetched) summary.fetched++;
        if (r.pulled) summary.pulled++;
        if (r.error) summary.errors.push({ name: findProject(r.id)?.name || r.id, error: r.error });
      }
      await refreshGithub();
      const target = cfg.roots.find((r) => isDir(r));
      if (cfg.sync.autoCloneMissing && hub.github.authed && target) {
        for (const repo of hub.github.missing) {
          hub.busy.progress = `Klone ${repo.nameWithOwner}`;
          bump();
          try {
            await sync.cloneRepo(repo.nameWithOwner, target);
            summary.cloned.push(repo.nameWithOwner);
          } catch (err) {
            summary.errors.push({ name: repo.nameWithOwner, error: err.message });
          }
        }
      }
      await scanNow();
      summary.at = Date.now();
      hub.lastSync = summary;
      log(`Sync: ${summary.fetched} geholt, ${summary.pulled} aktualisiert, ${summary.cloned.length} geklont, ${summary.errors.length} Fehler`);
    })()
      .catch((err) => log(`Sync fehlgeschlagen: ${err.stack || err}`))
      .finally(() => {
        hub.busy.syncing = false;
        hub.busy.progress = null;
        syncPromise = null;
        bump();
      });
    return syncPromise;
  }

  async function reinspect(p) {
    const fresh = await inspectProject(p.path, p.root, p.group, cfg);
    const idx = hub.data.projects.findIndex((x) => x.id === p.id);
    if (idx >= 0) hub.data.projects[idx] = fresh;
    else hub.data.projects.push(fresh);
    recomputeMissing();
    bump();
    return fresh;
  }

  function schedule() {
    while (timers.length) clearInterval(timers.pop());
    timers.push(setInterval(() => scanNow(), 10 * 60_000).unref());
    if (!noSync && cfg.sync.intervalMinutes > 0) {
      timers.push(setInterval(() => runSync(), cfg.sync.intervalMinutes * 60_000).unref());
    }
  }

  // ---------- API ----------
  function stateBody() {
    return {
      version: hub.version,
      app: { version: VERSION, platform: process.platform, configPath: cfgPath, cacheDir: cfg.cacheDir },
      busy: hub.busy,
      lastSync: hub.lastSync,
      scannedAt: hub.data.scannedAt,
      scanMs: hub.data.scanMs,
      fromCache: Boolean(hub.data.fromCache),
      roots: hub.data.roots,
      projects: hub.data.projects,
      github: {
        available: hub.github.available,
        authed: hub.github.authed,
        user: hub.github.user,
        error: hub.github.error,
        fetchedAt: hub.github.fetchedAt,
        missing: hub.github.missing.map((r) => ({
          nameWithOwner: r.nameWithOwner,
          name: r.name,
          url: r.url,
          description: r.description || '',
          pushedAt: r.pushedAt ? Date.parse(r.pushedAt) : null,
          isPrivate: r.isPrivate,
        })),
      },
      settings: {
        maxMePath: cfg.maxMePath,
        maxMeAvailable: Boolean(cfg.maxMePath) && isDir(cfg.maxMePath),
        editor: cfg.editor,
        autoCloneMissing: cfg.sync.autoCloneMissing,
      },
    };
  }

  function hubIndexMarkdown() {
    const esc = (s) => String(s || '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ');
    const day = new Date(hub.data.scannedAt || Date.now()).toISOString().slice(0, 10);
    const rows = [...hub.data.projects]
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((p) => {
        const status = Date.now() - p.lastActivity < 30 * 86_400_000 ? 'aktiv' : 'pausiert';
        return `| ${esc(p.name)} | ${status} | ${esc(p.spine.hotParsed?.focus)} | \`${esc(p.path)}\` | ${p.flavor} | ${day} |`;
      });
    return ['| Projekt | Status | Fokus | Pfad | Flavor | Zuletzt synct |', '|---|---|---|---|---|---|', ...rows, ''].join('\n');
  }

  async function createProject(body) {
    const name = String(body.name || '').trim();
    if (!NAME_RE.test(name) || RESERVED_RE.test(name) || /[. ]$/.test(name)) {
      return [400, { error: 'Name: Buchstaben, Ziffern, Leerzeichen, . _ - ( ), max. 64 Zeichen.' }];
    }
    const root = cfg.roots[Number(body.rootIndex) || 0];
    if (!root) return [400, { error: 'Unbekannter Wurzelordner.' }];
    const drive = path.parse(root).root;
    if (!isDir(drive)) return [409, { error: `Laufwerk ${drive} ist nicht verbunden.` }];
    fs.mkdirSync(root, { recursive: true });
    const target = path.join(root, name);
    if (fs.existsSync(target)) return [409, { error: 'Ein Ordner mit diesem Namen existiert bereits.' }];
    fs.mkdirSync(target);
    const notes = [];
    if (body.git) {
      let r = await run('git', ['init', '-b', 'main'], { cwd: target });
      if (!r.ok) r = await run('git', ['init'], { cwd: target });
      if (!r.ok) notes.push('Git konnte nicht initialisiert werden.');
    }
    if (body.spine) {
      if (cfg.maxMePath && isDir(cfg.maxMePath)) {
        await actions.openTerminal(target, ['claude', actions.spinePrompt(cfg.maxMePath)]).catch((e) => notes.push(e.message));
      } else notes.push(`MAX-ME nicht gefunden (${cfg.maxMePath || 'kein Pfad'}) – SPINE-Setup übersprungen.`);
    } else if (body.openClaude) {
      await actions.openTerminal(target, ['claude']).catch((e) => notes.push(e.message));
    }
    const p = await inspectProject(target, root, null, cfg);
    hub.data.projects.push(p);
    const rootEntry = hub.data.roots.find((r) => r.path === root);
    if (rootEntry) {
      rootEntry.online = true;
      rootEntry.count++;
    }
    recomputeMissing();
    saveCache();
    bump();
    log(`Neues Projekt: ${target}`);
    return [201, { id: p.id, notes }];
  }

  async function doAction(body) {
    if (body.repo) {
      const repo = hub.github.missing.find((r) => r.nameWithOwner === body.repo);
      if (!repo) return [404, { error: 'Repository unbekannt.' }];
      if (body.action === 'github') await actions.openUrl(repo.url);
      else if (body.action === 'clone') {
        const root = cfg.roots[Number(body.rootIndex) || 0];
        if (!root || !isDir(path.parse(root).root)) return [409, { error: 'Ziel-Laufwerk nicht verbunden.' }];
        const target = await sync.cloneRepo(repo.nameWithOwner, root);
        const p = await inspectProject(target, root, null, cfg);
        hub.data.projects.push(p);
        recomputeMissing();
        saveCache();
        bump();
        return [200, { ok: true, id: p.id }];
      } else return [400, { error: 'Unbekannte Aktion.' }];
      return [200, { ok: true }];
    }
    const p = findProject(body.id);
    if (!p) return [404, { error: 'Projekt nicht gefunden – bitte neu scannen.' }];
    if (!isDir(p.path)) return [410, { error: 'Ordner existiert nicht mehr (Laufwerk getrennt?).' }];
    switch (body.action) {
      case 'explorer':
        await actions.openFolder(p.path);
        break;
      case 'editor':
        await actions.openEditor(p.path, cfg.editor);
        break;
      case 'terminal':
        await actions.openTerminal(p.path);
        break;
      case 'claude':
        await actions.openTerminal(p.path, ['claude']);
        break;
      case 'spine':
        if (!cfg.maxMePath || !isDir(cfg.maxMePath)) return [409, { error: `MAX-ME nicht gefunden: ${cfg.maxMePath || '(kein Pfad)'}` }];
        await actions.openTerminal(p.path, ['claude', actions.spinePrompt(cfg.maxMePath)]);
        break;
      case 'github':
        if (!p.git?.remote) return [409, { error: 'Kein GitHub-Remote.' }];
        await actions.openUrl(p.git.remote.url);
        break;
      case 'sync': {
        const r = await sync.syncProject(p, cfg);
        await reinspect(p);
        if (r.error) return [502, { error: r.error }];
        return [200, { ok: true, result: r }];
      }
      case 'refresh':
        await reinspect(p);
        break;
      default:
        return [400, { error: 'Unbekannte Aktion.' }];
    }
    return [200, { ok: true }];
  }

  async function api(req, res, url) {
    const route = `${req.method} ${url.pathname}`;
    const body = req.method === 'POST' ? await readBody(req) : null;
    if (body === undefined) return json(res, 413, { error: 'Anfrage zu groß.' });

    if (route === 'GET /api/state') {
      const since = Number(url.searchParams.get('since'));
      if (since && since === hub.version) return json(res, 200, { version: hub.version, unchanged: true, busy: hub.busy });
      return json(res, 200, stateBody());
    }
    if (route === 'POST /api/scan') {
      scanNow();
      return json(res, 202, { ok: true });
    }
    if (route === 'POST /api/sync') {
      runSync();
      return json(res, 202, { ok: true });
    }
    if (route === 'POST /api/github/refresh') {
      await refreshGithub();
      return json(res, 200, { ok: true });
    }
    if (route === 'POST /api/action') {
      const [code, out] = await doAction(body || {});
      return json(res, code, out);
    }
    if (route === 'POST /api/new') {
      const [code, out] = await createProject(body || {});
      return json(res, code, out);
    }
    if (route === 'GET /api/config') {
      return json(res, 200, { config: cfg, configPath: cfgPath });
    }
    if (route === 'POST /api/config') {
      const { cfg: next, error } = applyUpdate(cfg, body);
      if (error) return json(res, 400, { error });
      const rootsChanged = JSON.stringify(next.roots) !== JSON.stringify(cfg.roots) || next.scanDepth !== cfg.scanDepth;
      cfg = next;
      saveConfig(cfgPath, cfg);
      schedule();
      if (rootsChanged) {
        hub.data.roots = cfg.roots.map((r) => ({ path: r, label: driveLabel(r), online: isDir(r), count: 0 }));
        hub.data.projects = [];
        scanNow();
      }
      bump();
      log('Einstellungen gespeichert');
      return json(res, 200, { ok: true, config: cfg });
    }
    if (route === 'GET /api/hub-index') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(hubIndexMarkdown());
    }
    const m = /^GET \/api\/project\/([a-f0-9]{12})$/.exec(route);
    if (m) {
      const p = findProject(m[1]);
      if (!p) return json(res, 404, { error: 'Projekt nicht gefunden.' });
      let names = new Set();
      try {
        names = new Set(fs.readdirSync(p.path));
      } catch {
        return json(res, 410, { error: 'Ordner nicht erreichbar.' });
      }
      const detail = await gitDetail(p.path, { trust: cfg.git?.trustRoots !== false });
      return json(res, 200, { project: p, commits: detail?.commits || [], cloudBranches: detail?.cloudBranches || [], readme: readmeExcerpt(p.path, names) });
    }
    return json(res, 404, { error: 'Unbekannter Endpunkt.' });
  }

  // ---------- HTTP plumbing ----------
  let server;
  const allowedHosts = () => {
    const p = server.address().port;
    return [`127.0.0.1:${p}`, `localhost:${p}`, `[::1]:${p}`];
  };
  function json(res, code, data) {
    res.writeHead(code, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }
  function readBody(req) {
    return new Promise((resolve) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > 64 * 1024) {
          resolve(undefined);
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          resolve({});
        }
      });
      req.on('error', () => resolve(undefined));
    });
  }
  function tokenOk(given) {
    if (typeof given !== 'string' || given.length !== token.length) return false;
    return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token));
  }
  function serveStatic(req, res, pathname) {
    if (pathname === '/' || pathname === '/index.html') {
      const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8').replace('{{TOKEN}}', token);
      res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    if (!pathname.startsWith('/assets/')) return json(res, 404, { error: 'Nicht gefunden.' });
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname.slice('/assets/'.length))));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      return json(res, 404, { error: 'Nicht gefunden.' });
    }
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const host = String(req.headers.host || '').toLowerCase();
      if (!allowedHosts().includes(host)) return json(res, 403, { error: 'Host nicht erlaubt.' });
      if (url.pathname === '/api/ping') return json(res, 200, { app: 'projekt-hub', version: VERSION });
      if (url.pathname.startsWith('/api/')) {
        if (!tokenOk(req.headers['x-hub-token'])) return json(res, 403, { error: 'Sitzung abgelaufen – Seite neu laden.' });
        const origin = req.headers.origin;
        if (req.method !== 'GET' && origin && !allowedHosts().some((h) => origin === `http://${h}`)) {
          return json(res, 403, { error: 'Fremder Ursprung.' });
        }
        return await api(req, res, url);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Methode nicht erlaubt.' });
      return serveStatic(req, res, url.pathname);
    } catch (err) {
      log(`Fehler: ${err.stack || err}`);
      if (!res.headersSent) json(res, 500, { error: err.message || 'Interner Fehler.' });
      else res.end();
    }
  });

  return {
    server,
    token,
    get config() {
      return cfg;
    },
    log,
    scanNow,
    runSync,
    refreshGithub,
    listen(listenPort = cfg.port) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, '127.0.0.1', () => {
          server.off('error', reject);
          loadCache();
          schedule();
          resolve(server.address().port);
        });
      });
    },
    close() {
      while (timers.length) clearInterval(timers.pop());
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function pingExisting(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data).app === 'projekt-hub');
        } catch {
          resolve(false);
        }
      });
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hub = createHub({ configPath: args.config, port: args.port, noSync: args.noSync });
  const port = hub.config.port;
  const url = `http://127.0.0.1:${port}/`;
  try {
    await hub.listen(port);
  } catch (err) {
    if (err.code === 'EADDRINUSE' && (await pingExisting(port))) {
      // Hub already running (e.g. from autostart): just open the browser.
      if (args.open) await actions.openUrl(url).catch(() => {});
      process.exit(0);
    }
    hub.log(`Start fehlgeschlagen: ${err.message}`);
    process.exit(1);
  }
  hub.log(`Projekt-Hub ${VERSION} läuft auf ${url}`);
  hub.log(`Wurzeln: ${hub.config.roots.join(' | ')}`);
  if (args.open) actions.openUrl(url).catch((e) => hub.log(`Browser öffnen fehlgeschlagen: ${e.message}`));
  await hub.scanNow();
  hub.refreshGithub().then(() => {
    if (!args.noSync && hub.config.sync.onStart) hub.runSync();
  });
  const stop = () => hub.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) main();

module.exports = { createHub, VERSION };
