'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { createBasic, createFakeGh, DEMO_REPOS } = require('./fixtures');
const { createHub } = require('../app/server');
const { inspectProject } = require('../app/lib/scanner');
const { syncProject } = require('../app/lib/sync');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-srv-'));
const root = path.join(tmp, 'H', 'Projekte');
fs.mkdirSync(root, { recursive: true });
createBasic(root);
const bin = path.join(tmp, 'bin');
createFakeGh(bin, DEMO_REPOS.map((r) => (r.name === 'z-share' ? { ...r, nameWithOwner: 'zelos0/alpha', name: 'alpha' } : r)));
process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
const cfgFile = path.join(tmp, 'config.json');
fs.writeFileSync(
  cfgFile,
  JSON.stringify({ roots: [root, path.join(tmp, 'X', 'offline')], cacheDir: path.join(tmp, 'cache'), maxMePath: '', sync: { onStart: false, intervalMinutes: 0, autoCloneMissing: false } }),
);

let hub;
let port;
let token;

function request(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          /* not json */
        }
        resolve({ status: res.statusCode, headers: res.headers, text: data, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) {
      req.setHeader('Content-Type', 'application/json');
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}
const authed = (method, p, body) => request(method, p, { headers: { 'X-Hub-Token': token }, body });

test.before(async () => {
  hub = createHub({ configPath: cfgFile, noSync: true, quiet: true });
  port = await hub.listen(0);
  token = hub.token;
  await hub.scanNow();
  await hub.refreshGithub();
});
test.after(async () => {
  await hub.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('index page carries the session token and strict security headers', async () => {
  const res = await request('GET', '/');
  assert.equal(res.status, 200);
  assert.ok(res.text.includes(`content="${token}"`));
  assert.match(res.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('API rejects missing token, foreign Host (DNS rebinding) and foreign Origin', async () => {
  assert.equal((await request('GET', '/api/state')).status, 403);
  assert.equal((await request('GET', '/api/state', { headers: { 'X-Hub-Token': 'x'.repeat(48) } })).status, 403);
  assert.equal((await request('GET', '/api/state', { headers: { Host: 'evil.example:80', 'X-Hub-Token': token } })).status, 403);
  const foreign = await request('POST', '/api/scan', { headers: { 'X-Hub-Token': token, Origin: 'http://evil.example' }, body: {} });
  assert.equal(foreign.status, 403);
  assert.equal((await request('GET', '/api/ping')).json.app, 'projekt-hub');
});

test('static files are served, path traversal is not', async () => {
  assert.equal((await request('GET', '/assets/app.css')).status, 200);
  assert.equal((await request('GET', '/assets/..%2fserver.js')).status, 404);
  assert.equal((await request('GET', '/assets/%2e%2e/%2e%2e/package.json')).status, 404);
  assert.equal((await request('GET', '/server.js')).status, 404);
});

test('state lists projects with SPINE, git and stack details', async () => {
  const { json } = await authed('GET', '/api/state');
  const names = json.projects.map((p) => p.name).sort();
  assert.deepEqual(names, ['Kunden', 'alpha', 'beta', 'empty-folder', 'gamma']);
  const alpha = json.projects.find((p) => p.name === 'alpha');
  assert.equal(alpha.spine.level, 'full');
  assert.equal(alpha.spine.hotParsed.focus, 'Login-Flow bauen');
  assert.deepEqual(alpha.spine.activeExtensions, ['Invariant-Check', 'Prompt-Cache-Contract', 'Session-Snapshot-Contract']);
  assert.deepEqual(alpha.stack, ['Next.js', 'TypeScript']);
  assert.equal(alpha.pm, 'pnpm');
  assert.equal(alpha.git.ahead, 1);
  assert.equal(alpha.git.untracked, 1);
  assert.equal(alpha.git.cloudBranches, 1);
  assert.equal(alpha.git.remote.nameWithOwner, 'zelos0/alpha');
  assert.equal(alpha.git.pulse.length, 12);
  const beta = json.projects.find((p) => p.name === 'beta');
  assert.equal(beta.description, 'Beta is a Python tool for invoices.');
  assert.equal(beta.spine.level, 'none');
  assert.equal(json.projects.find((p) => p.name === 'gamma').flavor, 'FILES');
  assert.deepEqual(json.roots.map((r) => r.online), [true, false]);
  const unchanged = await authed('GET', `/api/state?since=${json.version}`);
  assert.equal(unchanged.json.unchanged, true);
});

test('GitHub view lists repos without a local folder (forks/archived excluded) and can clone', async () => {
  const { json } = await authed('GET', '/api/state');
  assert.equal(json.github.authed, true);
  assert.deepEqual(json.github.missing.map((r) => r.nameWithOwner).sort(), ['zelos0/award-site', 'zelos0/stimmen-labor']);
  const res = await authed('POST', '/api/action', { repo: 'zelos0/award-site', action: 'clone', rootIndex: 0 });
  assert.equal(res.status, 200, res.text);
  assert.ok(fs.existsSync(path.join(root, 'award-site', '.git')));
  const after = await authed('GET', '/api/state');
  assert.deepEqual(after.json.github.missing.map((r) => r.nameWithOwner), ['zelos0/stimmen-labor']);
  assert.equal((await authed('POST', '/api/action', { repo: 'nope/nope', action: 'clone' })).status, 404);
});

test('project detail returns commits and cloud-session branches', async () => {
  const { json } = await authed('GET', '/api/state');
  const alpha = json.projects.find((p) => p.name === 'alpha');
  const d = await authed('GET', `/api/project/${alpha.id}`);
  assert.equal(d.status, 200);
  assert.equal(d.json.commits[0].subject, 'wip: not pushed');
  assert.equal(d.json.cloudBranches[0].name, 'claude/session-abc');
  assert.equal((await authed('GET', '/api/project/000000000000')).status, 404);
});

test('new project: validates names, creates folder with git, refuses duplicates', async () => {
  for (const bad of ['CON', 'nul.txt', 'a/b', '..', 'x'.repeat(65), 'trailing.', 'a&b', 'a"b']) {
    const r = await authed('POST', '/api/new', { name: bad, rootIndex: 0 });
    assert.equal(r.status, 400, `should reject ${bad}`);
  }
  const ok = await authed('POST', '/api/new', { name: 'Stimmen Labor', rootIndex: 0, git: true });
  assert.equal(ok.status, 201, ok.text);
  assert.ok(fs.existsSync(path.join(root, 'Stimmen Labor', '.git')));
  assert.equal((await authed('POST', '/api/new', { name: 'Stimmen Labor', rootIndex: 0 })).status, 409);
  // Root folder missing but its drive present -> root is created (on Windows a missing drive letter gives 409).
  const missingRoot = await authed('POST', '/api/new', { name: 'Neu', rootIndex: 1 });
  if (process.platform === 'win32') assert.equal(missingRoot.status, 409);
  else assert.equal(missingRoot.status, 201);
  const st = await authed('GET', '/api/state');
  assert.ok(st.json.projects.some((p) => p.id === ok.json.id));
});

test('actions: unknown project 404, console actions fail cleanly off Windows', async () => {
  assert.equal((await authed('POST', '/api/action', { id: 'ffffffffffff', action: 'claude' })).status, 404);
  const { json } = await authed('GET', '/api/state');
  const alpha = json.projects.find((p) => p.name === 'alpha');
  assert.equal((await authed('POST', '/api/action', { id: alpha.id, action: 'bogus' })).status, 400);
  if (process.platform !== 'win32') {
    const r = await authed('POST', '/api/action', { id: alpha.id, action: 'claude' });
    assert.equal(r.status, 500);
    assert.match(r.json.error, /nur unter Windows/);
  }
  const spine = await authed('POST', '/api/action', { id: alpha.id, action: 'spine' });
  assert.equal(spine.status, 409, 'MAX-ME path missing');
});

test('settings: invalid input rejected, valid input persisted to config.json', async () => {
  assert.equal((await authed('POST', '/api/config', { editor: 'rm -rf' })).status, 400);
  const r = await authed('POST', '/api/config', { editor: 'cursor', sync: { intervalMinutes: 15 } });
  assert.equal(r.status, 200);
  const saved = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  assert.equal(saved.editor, 'cursor');
  assert.equal(saved.sync.intervalMinutes, 15);
});

test('HUB index export uses the START.md column layout', async () => {
  const r = await authed('GET', '/api/hub-index');
  assert.equal(r.status, 200);
  const lines = r.text.trim().split('\n');
  assert.equal(lines[0], '| Projekt | Status | Fokus | Pfad | Flavor | Zuletzt synct |');
  assert.ok(lines.some((l) => l.startsWith('| alpha | aktiv | Login-Flow bauen |')));
});

test('scan cache is written to the cache dir', () => {
  assert.ok(fs.existsSync(path.join(tmp, 'cache', 'scan-cache.json')));
});

test('syncProject fast-forwards a clean repo and leaves dirty or diverged repos alone', async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-sync-'));
  const g = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
  const bare = path.join(work, 'origin.git');
  g(work, 'init', '-q', '--bare', '-b', 'main', bare);
  const a = path.join(work, 'a');
  const b = path.join(work, 'b');
  g(work, 'clone', '-q', bare, a);
  fs.writeFileSync(path.join(a, 'f.txt'), '1');
  g(a, 'add', '.');
  g(a, 'commit', '-q', '-m', 'one');
  g(a, 'push', '-q', 'origin', 'HEAD:main');
  g(work, 'clone', '-q', bare, b);
  fs.writeFileSync(path.join(a, 'f.txt'), '2');
  g(a, 'commit', '-q', '-am', 'two');
  g(a, 'push', '-q', 'origin', 'HEAD:main');

  const cfg = { git: { trustRoots: true }, sync: { autoPull: true } };
  let p = await inspectProject(b, work, null, cfg);
  let r = await syncProject(p, cfg);
  assert.equal(r.pulled, 1);
  assert.equal(fs.readFileSync(path.join(b, 'f.txt'), 'utf8'), '2');

  fs.writeFileSync(path.join(a, 'f.txt'), '3');
  g(a, 'commit', '-q', '-am', 'three');
  g(a, 'push', '-q', 'origin', 'HEAD:main');
  fs.writeFileSync(path.join(b, 'local.txt'), 'dirty');
  p = await inspectProject(b, work, null, cfg);
  r = await syncProject(p, cfg);
  assert.equal(r.pulled, false, 'dirty tree is never touched');
  assert.equal(fs.readFileSync(path.join(b, 'f.txt'), 'utf8'), '2');
  fs.rmSync(work, { recursive: true, force: true });
});
