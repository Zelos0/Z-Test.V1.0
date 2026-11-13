'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const IS_WIN = process.platform === 'win32';

/**
 * Runs a program without a shell. Never rejects: resolves with ok/code/stdout/stderr
 * so callers can degrade gracefully (a missing `git` or `gh` must not crash a scan).
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        env: opts.env || process.env,
        timeout: opts.timeout ?? 10_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
      },
      (err, stdout, stderr) => {
        let error = null;
        if (err) {
          if (err.code === 'ENOENT') error = 'ENOENT';
          else if (err.killed) error = 'TIMEOUT';
          else error = 'FAILED';
        }
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          error,
        });
      },
    );
  });
}

/** Minimal promise concurrency limiter. */
function pLimit(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/** Reads a small text file; returns null if missing or larger than maxBytes. */
function readSmall(file, maxBytes = 256 * 1024) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > maxBytes) return null;
    return stripBom(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readJson(file, maxBytes) {
  const text = readSmall(file, maxBytes);
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Atomic-ish JSON write (temp file + rename), UTF-8 without BOM. */
function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Key used to compare paths: case-insensitive on Windows. */
function pathKey(p) {
  const norm = path.resolve(p);
  return IS_WIN ? norm.toLowerCase() : norm;
}

/** Drive letter ("H:") or a short label for non-Windows roots. */
function driveLabel(root) {
  const m = /^([A-Za-z]):/.exec(root);
  if (m) return `${m[1].toUpperCase()}:`;
  const seg = root.split(/[\\/]/).find((s) => /^[A-Za-z]:$/.test(s));
  if (seg) return seg.toUpperCase();
  const base = path.basename(root) || root;
  return base.slice(0, 2).toUpperCase();
}

module.exports = {
  IS_WIN,
  run,
  pLimit,
  readSmall,
  readJson,
  writeJson,
  stripBom,
  mtimeMs,
  isDir,
  pathKey,
  driveLabel,
};
