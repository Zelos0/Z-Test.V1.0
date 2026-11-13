'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { readSmall, readJson, mtimeMs, isDir, pathKey, driveLabel, pLimit } = require('./util');
const { gitSummary } = require('./git');

const SKIP_DIRS = new Set([
  'node_modules', '$recycle.bin', 'system volume information', 'dist', 'build', 'out',
  '.next', '.venv', 'venv', '__pycache__', 'found.000', 'recovery',
]);
const NOISE_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);

const CODE_MARKERS = [
  '.git', 'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Cargo.toml', 'go.mod',
  'project.godot', 'composer.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'deno.json',
  'Gemfile', 'pubspec.yaml', 'CMakeLists.txt', 'Makefile', 'index.html', 'src',
];
const SPINE_MARKERS = ['AGENTS.md', 'CLAUDE.md', '.snapshot'];

function projectId(dir) {
  return crypto.createHash('sha1').update(pathKey(dir)).digest('hex').slice(0, 12);
}

function skipName(name) {
  return name.startsWith('.') || name.startsWith('$') || name.startsWith('~') || SKIP_DIRS.has(name.toLowerCase());
}

/** Placeholders like "[vom Nutzer zu ergänzen]" count as empty. */
function cleanValue(v) {
  const s = String(v || '').replace(/`/g, '').replace(/\s+/g, ' ').trim();
  if (!s || /^\[.*\]$/.test(s) || s === '—' || s === '-') return '';
  return s;
}

function hotKey(label) {
  const k = label.toLowerCase();
  if (k.includes('fokus') || k.includes('focus')) return 'focus';
  if (k.includes('nächst') || k.includes('naechst') || k.includes('next')) return 'next';
  if (k.includes('letzt') || k.includes('last') || k.includes('zuletzt')) return 'last';
  if (k.includes('blocker') || k.includes('offen') || k.includes('open')) return 'blockers';
  return null;
}

/** Parses .snapshot/HOT.md bullets ("- Aktueller Fokus: …", continuation lines indented). */
function parseHot(text) {
  const out = {};
  let cur = null;
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^[-*]\s+(?:\*\*)?([^:*\n]{2,60}?)(?:\*\*)?\s*:\s*(.*)$/.exec(line);
    if (m) {
      cur = hotKey(m[1]);
      if (cur) out[cur] = m[2];
      continue;
    }
    if (cur && /^\s+\S/.test(line)) out[cur] += ' ' + line.trim();
    else cur = null;
  }
  for (const k of Object.keys(out)) out[k] = cleanValue(out[k]);
  return out;
}

const DEP_TAGS = [
  ['next', 'Next.js', ['react']],
  ['nuxt', 'Nuxt', ['vue']],
  ['@sveltejs/kit', 'SvelteKit', ['svelte']],
  ['astro', 'Astro'],
  ['@remix-run/react', 'Remix', ['react']],
  ['electron', 'Electron'],
  ['@tauri-apps/api', 'Tauri'],
  ['svelte', 'Svelte'],
  ['vue', 'Vue'],
  ['react', 'React'],
  ['remotion', 'Remotion'],
  ['three', 'Three.js'],
  ['express', 'Express'],
  ['fastify', 'Fastify'],
  ['vite', 'Vite'],
  ['tailwindcss', 'Tailwind'],
  ['typescript', 'TypeScript'],
];

function detectStack(dir, names) {
  const tags = [];
  const add = (t) => {
    if (!tags.includes(t)) tags.push(t);
  };
  let pm = null;
  let pkg = null;
  if (names.has('package.json')) {
    pkg = readJson(path.join(dir, 'package.json'), 512 * 1024) || {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const suppressed = new Set();
    for (const [dep, tag, hides] of DEP_TAGS) {
      if (deps[dep] && !suppressed.has(dep)) {
        add(tag);
        for (const h of hides || []) suppressed.add(h);
      }
    }
    if (!tags.length) add('Node.js');
    if (names.has('pnpm-lock.yaml')) pm = 'pnpm';
    else if (names.has('yarn.lock')) pm = 'yarn';
    else if (names.has('bun.lockb') || names.has('bun.lock')) pm = 'bun';
    else if (names.has('package-lock.json')) pm = 'npm';
  }
  if (names.has('Cargo.toml')) add('Rust');
  if (names.has('src-tauri')) add('Tauri');
  if (names.has('pyproject.toml') || names.has('requirements.txt') || names.has('setup.py')) add('Python');
  if (names.has('go.mod')) add('Go');
  if ([...names].some((n) => /\.(sln|csproj|fsproj)$/i.test(n))) add('.NET');
  if (names.has('project.godot')) add('Godot');
  if (names.has('ProjectSettings') && names.has('Assets')) add('Unity');
  if (names.has('composer.json')) add('PHP');
  if (names.has('pom.xml') || names.has('build.gradle') || names.has('build.gradle.kts')) add('JVM');
  if (names.has('pubspec.yaml')) add('Flutter');
  if (names.has('Gemfile')) add('Ruby');
  if (names.has('deno.json')) add('Deno');
  if (names.has('CMakeLists.txt')) add('C/C++');
  if (!tags.length && names.has('index.html')) add('HTML/CSS');
  return { tags: tags.slice(0, 4), pm, pkg };
}

function readmeExcerpt(dir, names) {
  const file = [...names].find((n) => /^readme(\.md|\.txt)?$/i.test(n));
  if (!file) return '';
  const text = readSmall(path.join(dir, file), 128 * 1024) || '';
  const paras = text.split(/\r?\n\s*\r?\n/);
  for (const p of paras) {
    const t = p.trim();
    if (!t || /^(#|!\[|\[!\[|<|```|---|\||>)/.test(t)) continue;
    return t.replace(/\s+/g, ' ').replace(/[*_`]/g, '').slice(0, 400);
  }
  return '';
}

function spineInfo(dir, names) {
  const agents = names.has('AGENTS.md');
  const claude = names.has('CLAUDE.md');
  const extensions = names.has('EXTENSIONS.md');
  const hotFile = path.join(dir, '.snapshot', 'HOT.md');
  const hotText = readSmall(hotFile, 64 * 1024);
  const hot = hotText != null;
  let activeExtensions = [];
  let unindexed = false;
  if (claude) {
    const m = /Active SPINE Extensions:\s*([^\n]+)/i.exec(readSmall(path.join(dir, 'CLAUDE.md'), 128 * 1024) || '');
    if (m) activeExtensions = m[1].split(',').map((s) => s.replace(/[`*]/g, '').trim()).filter(Boolean);
  }
  if (agents) {
    unindexed = /This project is not yet indexed/i.test(readSmall(path.join(dir, 'AGENTS.md'), 256 * 1024) || '');
  }
  const count = [agents, claude, hot].filter(Boolean).length;
  return {
    level: count === 3 ? 'full' : count > 0 ? 'partial' : 'none',
    agents,
    claude,
    extensions,
    hot,
    unindexed,
    activeExtensions,
    hotParsed: hot ? parseHot(hotText) : null,
    hotUpdated: hot ? mtimeMs(hotFile) : null,
  };
}

function listNames(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

/** Builds the list entry for one project folder. */
async function inspectProject(dir, root, group, cfg) {
  const entries = listNames(dir) || [];
  const names = new Set(entries.map((e) => e.name));
  const stack = detectStack(dir, names);
  const spine = spineInfo(dir, names);
  const isCode = CODE_MARKERS.some((m) => names.has(m)) || stack.tags.length > 0;
  const git = await gitSummary(dir, { trust: cfg.git?.trustRoots !== false });

  let newest = mtimeMs(dir);
  for (const e of entries.slice(0, 300)) {
    if (e.name === '.git' || e.name === 'node_modules') continue;
    newest = Math.max(newest, mtimeMs(path.join(dir, e.name)));
  }
  const lastActivity = Math.max(newest, spine.hotUpdated || 0, git?.lastCommit?.time || 0, git?.cloudLatest || 0);
  const description = cleanValue(stack.pkg?.description) || readmeExcerpt(dir, names);

  return {
    id: projectId(dir),
    name: path.basename(dir),
    group: group || null,
    path: dir,
    root,
    flavor: isCode ? 'CODE' : 'FILES',
    stack: stack.tags,
    pm: stack.pm,
    description: description.slice(0, 200),
    spine,
    git,
    lastActivity,
    empty: entries.length === 0,
  };
}

/** Finds project folders under one root (depth 1, or depth 2 for marker-less group folders). */
function findProjectDirs(root, depth) {
  const found = [];
  const walk = (dir, level, group) => {
    const entries = listNames(dir);
    if (!entries) return;
    for (const e of entries) {
      if (!e.isDirectory() || skipName(e.name)) continue;
      const child = path.join(dir, e.name);
      if (level < depth) {
        const inner = listNames(child) || [];
        const names = new Set(inner.map((i) => i.name));
        const marked = [...CODE_MARKERS, ...SPINE_MARKERS, 'README.md'].some((m) => names.has(m));
        const hasFiles = inner.some((i) => i.isFile() && !NOISE_FILES.has(i.name.toLowerCase()));
        const subdirs = inner.filter((i) => i.isDirectory() && !skipName(i.name));
        if (!marked && !hasFiles && subdirs.length > 0) {
          walk(child, level + 1, group ? `${group}/${e.name}` : e.name);
          continue;
        }
      }
      found.push({ dir: child, group });
    }
  };
  walk(root, 1, null);
  return found;
}

async function scan(cfg) {
  const started = Date.now();
  const roots = [];
  const jobs = [];
  for (const root of cfg.roots) {
    const online = isDir(root);
    const dirs = online ? findProjectDirs(root, cfg.scanDepth === 2 ? 2 : 1) : [];
    roots.push({ path: root, label: driveLabel(root), online, count: dirs.length });
    for (const d of dirs) jobs.push({ ...d, root });
  }
  const limit = pLimit(6);
  const projects = await Promise.all(jobs.map((j) => limit(() => inspectProject(j.dir, j.root, j.group, cfg))));
  return { roots, projects, scannedAt: Date.now(), scanMs: Date.now() - started };
}

module.exports = { scan, inspectProject, findProjectDirs, parseHot, detectStack, projectId, cleanValue, readmeExcerpt };
