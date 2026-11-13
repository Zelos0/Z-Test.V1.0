'use strict';

/**
 * Builds realistic demo/test project trees with git history spread over 12 weeks.
 * Used by the tests and for visual QA (`node test/fixtures.js <dir>` writes a demo + config).
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const DAY = 86_400_000;

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function git(dir, args, daysAgo = 0) {
  const when = new Date(Date.now() - daysAgo * DAY).toISOString();
  return execFileSync('git', args, {
    cwd: dir,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Zelos',
      GIT_AUTHOR_EMAIL: 'zelos@example.invalid',
      GIT_COMMITTER_NAME: 'Zelos',
      GIT_COMMITTER_EMAIL: 'zelos@example.invalid',
      GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_DATE: when,
      GIT_CONFIG_NOSYSTEM: '1',
    },
  }).trim();
}

function commit(dir, daysAgo, msg) {
  write(path.join(dir, '.history', `${Date.now()}-${Math.random()}.txt`), msg);
  git(dir, ['add', '-A'], daysAgo);
  git(dir, ['commit', '-q', '-m', msg], daysAgo);
  return git(dir, ['rev-parse', 'HEAD']);
}

function initRepo(dir, remote) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'commit.gpgsign', 'false']);
  if (remote) git(dir, ['remote', 'add', 'origin', remote]);
}

/** Commit history: `days` is a list of "days ago" values (any order). */
function history(dir, days, prefix) {
  const sorted = [...days].sort((a, b) => b - a);
  let sha = null;
  sorted.forEach((d, i) => {
    sha = commit(dir, d, `${prefix} ${i + 1}`);
  });
  return sha;
}

function setUpstream(dir, sha) {
  git(dir, ['update-ref', 'refs/remotes/origin/main', sha]);
  git(dir, ['branch', '-q', '--set-upstream-to=origin/main', 'main']);
}

function cloudBranch(dir, name, daysAgo, msg) {
  const base = git(dir, ['rev-parse', 'HEAD']);
  git(dir, ['checkout', '-q', '-b', `tmp-${name}`]);
  const sha = commit(dir, daysAgo, msg);
  git(dir, ['checkout', '-q', 'main']);
  git(dir, ['branch', '-q', '-D', `tmp-${name}`]);
  git(dir, ['update-ref', `refs/remotes/origin/claude/${name}`, sha]);
  return base;
}

function spine(dir, { agents = true, claude = true, hot = null, extensions = true } = {}) {
  if (agents) write(path.join(dir, 'AGENTS.md'), '# SPINE framework\n\n## Child SPINE Index\n\nFlat project.\n');
  if (claude) {
    write(path.join(dir, 'CLAUDE.md'), '# CLAUDE.md\n\n@AGENTS.md\n\nActive SPINE Extensions: Invariant-Check, Prompt-Cache-Contract, Session-Snapshot-Contract\n');
  }
  if (extensions) write(path.join(dir, 'EXTENSIONS.md'), '# SPINE Extension-Pack\n');
  if (hot) {
    const lines = [`# HOT.md`, '', `- Aktueller Fokus: ${hot.focus}`, `- Letzter abgeschlossener Schritt: ${hot.last}`, `- Nächster Schritt: ${hot.next}`];
    if (hot.blockers) lines.push(`- Offene Blocker/Fragen: ${hot.blockers}`);
    write(path.join(dir, '.snapshot', 'HOT.md'), lines.join('\n') + '\n');
    write(path.join(dir, '.snapshot', 'ARCHIVE.md'), '# ARCHIVE\n');
  }
}

const pkg = (name, deps, extra = {}) => JSON.stringify({ name, version: '0.1.0', ...extra, dependencies: deps }, null, 2);
const spread = (n, maxDay, seed = 1) => Array.from({ length: n }, (_, i) => Math.max(0.05, ((i * 37 + seed * 11) % (maxDay * 10)) / 10));

/** Small, fast set for unit/integration tests. */
function createBasic(root) {
  const alpha = path.join(root, 'alpha');
  initRepo(alpha, 'https://github.com/zelos0/alpha.git');
  write(path.join(alpha, 'package.json'), pkg('alpha', { next: '15.0.0', react: '19.0.0', typescript: '5.6.0' }, { description: 'Alpha test app' }));
  write(path.join(alpha, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  spine(alpha, { hot: { focus: 'Login-Flow bauen', last: 'Routing steht', next: '[vom Nutzer zu ergänzen]' } });
  const sha = history(alpha, [40, 20, 10, 3, 1], 'feat: alpha');
  setUpstream(alpha, sha);
  commit(alpha, 0.2, 'wip: not pushed');
  cloudBranch(alpha, 'session-abc', 0.5, 'claude: cloud work');
  write(path.join(alpha, 'scratch.txt'), 'uncommitted');

  const beta = path.join(root, 'beta');
  fs.mkdirSync(beta, { recursive: true });
  write(path.join(beta, 'pyproject.toml'), '[project]\nname = "beta"\n');
  write(path.join(beta, 'README.md'), '# Beta\n\n[![badge](x)](y)\n\nBeta is a Python tool for invoices.\n');

  const gamma = path.join(root, 'gamma');
  write(path.join(gamma, 'track01.mp3'), '');
  spine(gamma, { claude: false, extensions: false });

  fs.mkdirSync(path.join(root, 'empty-folder'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });

  const group = path.join(root, 'Kunden', 'acme-shop');
  write(path.join(group, 'index.html'), '<!doctype html>');
  return { alpha, beta, gamma };
}

/** Richer set for visual QA. */
function createDemo(base) {
  const H = path.join(base, 'H:', 'Projekte');
  const D = path.join(base, 'D:', 'Archiv');

  let p = path.join(H, 'Z-Share');
  initRepo(p, 'https://github.com/zelos0/z-share.git');
  write(path.join(p, 'package.json'), pkg('z-share', { next: '15', react: '19', typescript: '5', tailwindcss: '4' }, { description: 'Self-hosted Datei-Freigabe über Cloudflare Tunnel' }));
  write(path.join(p, 'pnpm-lock.yaml'), '');
  spine(p, { hot: { focus: 'Cloudflare-Tunnel für große Uploads stabilisieren', last: 'Chunked Upload mit Resume eingebaut', next: 'Upload-Limit auf 2 GB anheben und testen' } });
  let sha = history(p, [...spread(26, 80, 1), 0.3, 0.6, 1.2, 2], 'feat: share');
  setUpstream(p, sha);
  commit(p, 0.1, 'wip: resume tokens');
  cloudBranch(p, 'upload-limit-2gb', 0.4, 'Upload-Limit konfigurierbar machen');
  cloudBranch(p, 'tunnel-healthcheck', 2.5, 'Healthcheck für den Tunnel');
  write(path.join(p, 'src', 'upload.ts'), 'export {}');
  write(path.join(p, 'notes.md'), 'x');
  write(path.join(p, 'todo.md'), 'x');

  p = path.join(H, 'VoicePotato');
  initRepo(p, 'https://github.com/zelos0/voicepotato.git');
  write(path.join(p, 'package.json'), pkg('voicepotato', { react: '19', '@tauri-apps/api': '2', typescript: '5' }, { description: 'Eigene Oberfläche für Voicemeeter Potato' }));
  write(path.join(p, 'Cargo.toml'), '[package]\nname="vp"\n');
  fs.mkdirSync(path.join(p, 'src-tauri'), { recursive: true });
  write(path.join(p, 'package-lock.json'), '{}');
  spine(p, { hot: { focus: 'Voicemeeter-FFI-Bridge: Kanal-Mute und Gain', last: 'Remote-API-DLL wird geladen', next: 'Gain-Fader an die Bridge hängen', blockers: 'DLL-Pfad unter Windows 11 ARM ungeklärt' } });
  sha = history(p, spread(18, 40, 2), 'feat: bridge');
  setUpstream(p, sha);

  p = path.join(H, 'Explainer-Studio');
  initRepo(p, 'https://github.com/zelos0/explainer-studio.git');
  write(path.join(p, 'package.json'), pkg('explainer', { remotion: '4', react: '19', typescript: '5' }, { description: 'Vox-artige Erklärvideos mit Remotion' }));
  spine(p, { hot: { focus: 'Parallax-Ebenen für Shot 4', last: 'Asset-Atlas exportiert', next: 'Voice-over timen' } });
  sha = history(p, spread(9, 70, 3), 'feat: shot');
  setUpstream(p, sha);

  p = path.join(H, 'Zelos-Website');
  initRepo(p, 'https://github.com/zelos0/z-test.v1.0.git');
  write(path.join(p, 'index.html'), '<!doctype html>');
  write(path.join(p, 'styles.css'), '');
  spine(p, { hot: null });
  sha = history(p, [62, 61, 30, 6], 'site');
  setUpstream(p, sha);

  p = path.join(H, 'Remote-Maus');
  initRepo(p, 'https://github.com/zelos0/remote-maus.git');
  write(path.join(p, 'package.json'), pkg('remote-maus', { electron: '33', typescript: '5' }, { description: 'Maus und Tastatur vom Handy aus steuern' }));
  write(path.join(p, 'yarn.lock'), '');
  history(p, [50, 44, 41, 39, 12, 11], 'feat: input');
  const head = git(p, ['rev-parse', 'HEAD']);
  setUpstream(p, head);
  git(p, ['reset', '-q', '--hard', 'HEAD~2']);

  p = path.join(H, 'Nebelpfad');
  initRepo(p, null);
  write(path.join(p, 'project.godot'), '; godot');
  spine(p, { claude: false, hot: { focus: 'Nebel-Shader performant machen', last: 'Prototyp-Level', next: '' } });
  history(p, spread(7, 84, 4), 'level');

  p = path.join(H, 'KI-Influencer');
  initRepo(p, 'https://github.com/zelos0/ki-influencer.git');
  write(path.join(p, 'requirements.txt'), 'fastapi\n');
  write(path.join(p, 'README.md'), '# KI-Influencer\n\nPipeline für konsistente Charaktere über Higgsfield und FAL.\n');
  spine(p, { hot: { focus: 'Charakter-Konsistenz über 20 Shots', last: 'Referenzblatt v3', next: 'Batch-Rendering automatisieren' } });
  sha = history(p, spread(14, 20, 5), 'pipeline');
  setUpstream(p, sha);

  p = path.join(H, 'Prompt-Bibliothek');
  write(path.join(p, 'video-prompts.md'), '# Prompts');
  write(path.join(p, 'bild-prompts.md'), '# Prompts');
  spine(p, { extensions: false, hot: { focus: 'Prompts nach Modell sortieren', last: 'Seedance-Vorlagen ergänzt', next: 'Duplikate zusammenführen' } });

  p = path.join(H, 'Projekt-Hub');
  initRepo(p, 'https://github.com/zelos0/projekt-hub.git');
  write(path.join(p, 'package.json'), pkg('projekt-hub', {}, { description: 'Lokales Dashboard für alle Projekte auf H:' }));
  spine(p, { hot: { focus: 'Projekt-Übersicht mit hochwertiger UI', last: 'Server, UI und Installer gebaut', next: 'Auf dem PC installieren' } });
  sha = history(p, [0.05, 0.1, 0.2, 0.3, 0.5, 0.8], 'hub');
  setUpstream(p, sha);

  fs.mkdirSync(path.join(H, 'Neue-Idee'), { recursive: true });

  p = path.join(D, 'Rechnungen-2025');
  write(path.join(p, '2025-01.pdf'), '');
  write(path.join(p, '2025-02.pdf'), '');
  spine(p, { claude: false, extensions: false });

  p = path.join(D, 'Musik-Stems');
  write(path.join(p, 'beat-01.wav'), '');
  write(path.join(p, 'README.md'), '# Stems\n\nGetrennte Spuren der Tracks 2024.\n');

  p = path.join(D, 'Alte-Landingpage');
  initRepo(p, null);
  write(path.join(p, 'index.html'), '');
  history(p, [300, 290], 'old');

  // File mtimes = time of last real activity, so "Zuletzt" reflects history, not fixture creation time.
  const ages = { 'Prompt-Bibliothek': 3, 'Neue-Idee': 0.02, 'Rechnungen-2025': 20, 'Musik-Stems': 45 };
  for (const root of [H, D]) {
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      let when = Date.now() - (ages[name] ?? 30) * DAY;
      if (fs.existsSync(path.join(dir, '.git'))) when = Number(git(dir, ['log', '-1', '--all', '--format=%ct'])) * 1000;
      ageTree(dir, when);
    }
  }
  return { H, D, offline: path.join(base, 'E:', 'Backup') };
}

function ageTree(dir, when) {
  const t = new Date(when);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) ageTree(full, when);
    fs.utimesSync(full, t, t);
  }
  fs.utimesSync(dir, t, t);
}

/** Fake `gh` CLI (POSIX shell) so the GitHub view can be tested without network or an account. */
function createFakeGh(binDir, repos) {
  fs.mkdirSync(binDir, { recursive: true });
  const json = JSON.stringify(repos).replace(/'/g, "'\\''");
  const script = `#!/bin/sh
case "$1 $2" in
  "auth status") exit 0 ;;
  "api user") echo zelos0 ;;
  "repo list") echo '${json}' ;;
  "repo clone") mkdir -p "$4" && git init -q "$4" && git -C "$4" remote add origin "https://github.com/$3.git" ;;
  *) echo "unsupported: $*" >&2; exit 1 ;;
esac
`;
  const file = path.join(binDir, 'gh');
  fs.writeFileSync(file, script, { mode: 0o755 });
  return file;
}

const DEMO_REPOS = [
  { nameWithOwner: 'zelos0/z-share', name: 'z-share', url: 'https://github.com/zelos0/z-share', description: '', pushedAt: new Date(Date.now() - 0.4 * DAY).toISOString(), isArchived: false, isFork: false, isPrivate: true },
  { nameWithOwner: 'zelos0/stimmen-labor', name: 'stimmen-labor', url: 'https://github.com/zelos0/stimmen-labor', description: 'Experimente mit Voice-Cloning und Dubbing', pushedAt: new Date(Date.now() - 1.2 * DAY).toISOString(), isArchived: false, isFork: false, isPrivate: true },
  { nameWithOwner: 'zelos0/award-site', name: 'award-site', url: 'https://github.com/zelos0/award-site', description: 'Awwwards-Versuch mit WebGL-Fluid', pushedAt: new Date(Date.now() - 9 * DAY).toISOString(), isArchived: false, isFork: false, isPrivate: false },
  { nameWithOwner: 'zelos0/old-fork', name: 'old-fork', url: 'https://github.com/zelos0/old-fork', description: 'fork', pushedAt: new Date(Date.now() - 90 * DAY).toISOString(), isArchived: false, isFork: true, isPrivate: false },
  { nameWithOwner: 'zelos0/archiv', name: 'archiv', url: 'https://github.com/zelos0/archiv', description: 'archived', pushedAt: new Date(Date.now() - 400 * DAY).toISOString(), isArchived: true, isFork: false, isPrivate: false },
];

module.exports = { createBasic, createDemo, createFakeGh, DEMO_REPOS };

if (require.main === module) {
  const out = path.resolve(process.argv[2] || 'demo');
  fs.rmSync(out, { recursive: true, force: true });
  const { H, D, offline } = createDemo(out);
  const bin = path.join(out, '_bin');
  createFakeGh(bin, DEMO_REPOS);
  const cfg = { port: 4310, roots: [H, D, offline], cacheDir: path.join(out, '_cache'), maxMePath: path.join(out, 'MAX-ME'), sync: { onStart: false, intervalMinutes: 0 } };
  fs.mkdirSync(cfg.maxMePath, { recursive: true });
  write(path.join(out, 'config.json'), JSON.stringify(cfg, null, 2));
  console.log(`Demo: ${out}\nconfig: ${path.join(out, 'config.json')}\nfake gh: ${bin}`);
}
