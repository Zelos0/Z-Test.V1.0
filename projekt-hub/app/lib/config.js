'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { IS_WIN, readJson, writeJson } = require('./util');

const APP_DIR = path.resolve(__dirname, '..');

function defaults() {
  return {
    port: 4310,
    roots: [IS_WIN ? 'H:\\Projekte' : path.join(os.homedir(), 'Projekte')],
    cacheDir: IS_WIN ? 'H:\\DevCache\\projekt-hub' : path.join(os.homedir(), '.cache', 'projekt-hub'),
    maxMePath: IS_WIN ? 'H:\\MY-SKILLS\\MAX-ME' : '',
    editor: 'code',
    scanDepth: 1,
    git: { trustRoots: true },
    sync: { onStart: true, intervalMinutes: 30, autoPull: true, autoCloneMissing: true },
    github: { owners: [], includeForks: false, includeArchived: false },
  };
}

/**
 * Config lookup order: --config arg, PROJEKT_HUB_CONFIG, <install dir>/config.json
 * (one level above app/, where install.ps1 writes it), then app/config.json.
 */
function resolveConfigPath(cliPath) {
  if (cliPath) return path.resolve(cliPath);
  if (process.env.PROJEKT_HUB_CONFIG) return path.resolve(process.env.PROJEKT_HUB_CONFIG);
  const installed = path.join(APP_DIR, '..', 'config.json');
  if (fs.existsSync(installed)) return installed;
  return path.join(APP_DIR, 'config.json');
}

function merge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      out[k] = merge(base[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

function loadConfig(file) {
  const raw = readJson(file) || {};
  const cfg = merge(defaults(), raw);
  // PowerShell's ConvertTo-Json can collapse a one-element array to a plain string.
  const roots = typeof cfg.roots === 'string' ? [cfg.roots] : cfg.roots;
  cfg.roots = (Array.isArray(roots) ? roots : []).filter((r) => typeof r === 'string' && r.trim());
  return cfg;
}

function saveConfig(file, cfg) {
  writeJson(file, cfg);
}

const EDITOR_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
// Characters that would be unsafe inside a cmd.exe command line or Windows Terminal args.
const UNSAFE_SHELL_RE = /["%!;^<>|&\r\n]/;

/** Validates a settings update from the UI; returns { cfg } or { error }. */
function applyUpdate(current, body) {
  const next = JSON.parse(JSON.stringify(current));
  if (!body || typeof body !== 'object') return { error: 'Ungültige Eingabe.' };

  if (body.roots !== undefined) {
    if (!Array.isArray(body.roots) || body.roots.length > 20) return { error: 'Bis zu 20 Wurzelordner erlaubt.' };
    const roots = [];
    for (const r of body.roots) {
      const v = String(r || '').trim();
      if (!v) continue;
      if (v.length > 260 || !path.isAbsolute(v)) return { error: `Kein absoluter Pfad: ${v}` };
      if (!roots.includes(v)) roots.push(v);
    }
    if (!roots.length) return { error: 'Mindestens ein Wurzelordner ist nötig.' };
    next.roots = roots;
  }
  if (body.maxMePath !== undefined) {
    const v = String(body.maxMePath || '').trim();
    if (v && (!path.isAbsolute(v) || UNSAFE_SHELL_RE.test(v))) return { error: 'MAX-ME-Pfad ist ungültig.' };
    next.maxMePath = v;
  }
  if (body.editor !== undefined) {
    const v = String(body.editor || '').trim();
    if (!EDITOR_RE.test(v)) return { error: 'Editor-Befehl: nur ein Programmname wie "code" oder "cursor".' };
    next.editor = v;
  }
  if (body.scanDepth !== undefined) {
    const v = Number(body.scanDepth);
    if (v !== 1 && v !== 2) return { error: 'Suchtiefe muss 1 oder 2 sein.' };
    next.scanDepth = v;
  }
  if (body.sync && typeof body.sync === 'object') {
    for (const k of ['onStart', 'autoPull', 'autoCloneMissing']) {
      if (body.sync[k] !== undefined) next.sync[k] = Boolean(body.sync[k]);
    }
    if (body.sync.intervalMinutes !== undefined) {
      const v = Math.round(Number(body.sync.intervalMinutes));
      if (!Number.isFinite(v) || v < 0 || v > 1440) return { error: 'Sync-Intervall: 0 bis 1440 Minuten.' };
      next.sync.intervalMinutes = v;
    }
  }
  if (body.github && typeof body.github === 'object') {
    if (body.github.owners !== undefined) {
      const owners = (Array.isArray(body.github.owners) ? body.github.owners : [])
        .map((o) => String(o).trim())
        .filter(Boolean);
      if (owners.some((o) => !OWNER_RE.test(o))) return { error: 'GitHub-Konten: nur Benutzer-/Organisationsnamen.' };
      next.github.owners = owners;
    }
    for (const k of ['includeForks', 'includeArchived']) {
      if (body.github[k] !== undefined) next.github[k] = Boolean(body.github[k]);
    }
  }
  return { cfg: next };
}

module.exports = { APP_DIR, defaults, resolveConfigPath, loadConfig, saveConfig, applyUpdate, UNSAFE_SHELL_RE };
