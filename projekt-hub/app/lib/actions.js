'use strict';

const { spawn } = require('node:child_process');
const { IS_WIN, run } = require('./util');
const { UNSAFE_SHELL_RE } = require('./config');

let wtAvailable = null;
async function hasWindowsTerminal() {
  if (wtAvailable === null) wtAvailable = IS_WIN ? (await run('where.exe', ['wt.exe'], { timeout: 4000 })).ok : false;
  return wtAvailable;
}

function detached(cmd, args, extra = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false, ...extra });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function assertShellSafe(...values) {
  for (const v of values) {
    if (UNSAFE_SHELL_RE.test(v)) {
      throw new Error('Pfad enthält Sonderzeichen (" % ! ; ^ < > | &), die nicht sicher an die Konsole übergeben werden können.');
    }
  }
}

/** Opens a folder in Explorer (Finder / xdg-open elsewhere). */
function openFolder(dir) {
  if (IS_WIN) return detached('explorer.exe', [dir]);
  return detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [dir]);
}

/** Opens an http(s) URL in the default browser without going through a shell. */
function openUrl(url) {
  if (!/^https?:\/\/[^\s"<>]+$/.test(url)) throw new Error('Ungültige URL.');
  if (IS_WIN) return detached('rundll32.exe', ['url.dll,FileProtocolHandler', url]);
  return detached(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

/** Opens the folder in the configured editor command (code, cursor, …). Editors are .cmd shims on Windows, so cmd.exe is needed. */
function openEditor(dir, editor) {
  if (!/^[A-Za-z0-9_.-]{1,40}$/.test(editor)) throw new Error('Ungültiger Editor-Befehl.');
  if (IS_WIN) {
    assertShellSafe(dir);
    return detached('cmd.exe', ['/d', '/s', '/c', `"${editor} "${dir}""`], { windowsVerbatimArguments: true, windowsHide: true });
  }
  return detached(editor, [dir]);
}

/**
 * Opens a new console in `dir`, optionally running a command (e.g. ["claude"]).
 * Prefers Windows Terminal; falls back to a classic cmd window.
 */
async function openTerminal(dir, command = []) {
  if (!IS_WIN) throw new Error('Konsole/Claude-Start ist nur unter Windows eingebaut.');
  assertShellSafe(dir, ...command);
  if (await hasWindowsTerminal()) {
    const args = ['-d', dir];
    if (command.length) args.push('cmd.exe', '/k', ...command);
    return detached('wt.exe', args);
  }
  const inner = command.map((c) => (/\s/.test(c) ? `"${c}"` : c)).join(' ');
  const line = `start "Projekt-Hub" /D "${dir}" cmd.exe${inner ? ` /k ${inner}` : ''}`;
  return detached('cmd.exe', ['/d', '/c', line], { windowsVerbatimArguments: true, windowsHide: true });
}

function spinePrompt(maxMePath) {
  return `Fuehre START.md aus ${maxMePath} fuer dieses Projekt aus`;
}

module.exports = { openFolder, openUrl, openEditor, openTerminal, spinePrompt, assertShellSafe };
