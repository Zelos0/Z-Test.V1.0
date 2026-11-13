'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run } = require('./util');

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0', // never hang on a credential prompt
  GCM_INTERACTIVE: 'Never', // Git Credential Manager: no GUI popups from a background scan
  LC_ALL: 'C',
};

const WEEKS = 12;
const DAY = 86_400_000;

/**
 * Runs git against one repo. Command-line config is "protected" config in git, so:
 * - safe.directory=<dir> lets repos on external drives (other owner SID) be read
 *   when the user trusts their own roots (config git.trustRoots);
 * - core.fsmonitor=false stops a repo-local config from executing a hook during `status`.
 */
function git(dir, args, { trust = true, timeout = 8000 } = {}) {
  const pre = ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false'];
  if (trust) pre.push('-c', `safe.directory=${dir.replace(/\\/g, '/')}`);
  return run('git', [...pre, '-C', dir, ...args], { env: GIT_ENV, timeout });
}

function hasGit(dir) {
  return fs.existsSync(path.join(dir, '.git'));
}

/** Parses `git status --porcelain=v2 --branch`. */
function parseStatus(text) {
  const out = { branch: null, upstream: null, ahead: 0, behind: 0, changes: 0, untracked: 0, conflicts: 0 };
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const b = line.slice(14).trim();
      out.branch = b === '(detached)' ? null : b;
      out.detached = b === '(detached)';
    } else if (line.startsWith('# branch.upstream ')) out.upstream = line.slice(18).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line);
      if (m) {
        out.ahead = Number(m[1]);
        out.behind = Number(m[2]);
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) out.changes++;
    else if (line.startsWith('u ')) out.conflicts++;
    else if (line.startsWith('? ')) out.untracked++;
  }
  return out;
}

/** Extracts owner/repo from a GitHub remote URL; drops any embedded credentials. */
function parseGithubRemote(url) {
  if (!url) return null;
  const m = /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], nameWithOwner: `${m[1]}/${m[2]}`, url: `https://github.com/${m[1]}/${m[2]}` };
}

/** Commit timestamps (seconds) -> commit counts per week, oldest first, current week last. */
function bucketWeeks(stamps, now = Date.now()) {
  const buckets = new Array(WEEKS).fill(0);
  for (const s of stamps) {
    const age = now - s * 1000;
    if (age < 0) {
      buckets[WEEKS - 1]++;
      continue;
    }
    const idx = WEEKS - 1 - Math.floor(age / (7 * DAY));
    if (idx >= 0) buckets[idx]++;
  }
  return buckets;
}

/** Lightweight info for the project list. */
async function gitSummary(dir, opts) {
  if (!hasGit(dir)) return null;
  const [status, last, remote, log, cloud] = await Promise.all([
    git(dir, ['status', '--porcelain=v2', '--branch', '--untracked-files=normal'], opts),
    git(dir, ['log', '-1', '--format=%ct%x1f%s'], opts),
    git(dir, ['config', '--get', 'remote.origin.url'], opts),
    git(dir, ['log', '--all', `--since=${WEEKS * 7}.days.ago`, '--format=%ct', '-n', '5000'], opts),
    git(dir, ['for-each-ref', '--sort=-committerdate', '--format=%(committerdate:unix)', 'refs/remotes/origin/claude/'], opts),
  ]);

  if (!status.ok) {
    const dubious = /dubious ownership|unsafe repository/i.test(status.stderr);
    return { error: dubious ? 'dubious-ownership' : status.error === 'ENOENT' ? 'git-missing' : 'status-failed' };
  }
  const st = parseStatus(status.stdout);
  let lastCommit = null;
  if (last.ok && last.stdout.trim()) {
    const [ts, subject] = last.stdout.trim().split('\x1f');
    lastCommit = { time: Number(ts) * 1000, subject: subject || '' };
  }
  const stamps = log.ok ? log.stdout.split('\n').filter(Boolean).map(Number) : [];
  const cloudStamps = cloud.ok ? cloud.stdout.split('\n').filter(Boolean).map(Number) : [];
  return {
    ...st,
    lastCommit,
    remote: parseGithubRemote(remote.stdout),
    hasRemote: Boolean(remote.stdout.trim()),
    pulse: bucketWeeks(stamps),
    commits12w: stamps.length,
    cloudBranches: cloudStamps.length,
    cloudLatest: cloudStamps.length ? cloudStamps[0] * 1000 : null,
  };
}

/** Heavier info, loaded only when a project is opened in the detail panel. */
async function gitDetail(dir, opts) {
  if (!hasGit(dir)) return null;
  const [log, cloud] = await Promise.all([
    git(dir, ['log', '-12', '--format=%h%x1f%ct%x1f%an%x1f%s'], opts),
    git(
      dir,
      ['for-each-ref', '--sort=-committerdate', '--count=12', '--format=%(refname:short)%1f%(committerdate:unix)%1f%(subject)', 'refs/remotes/origin/claude/'],
      opts,
    ),
  ]);
  const commits = log.ok
    ? log.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [hash, ts, author, subject] = l.split('\x1f');
          return { hash, time: Number(ts) * 1000, author, subject };
        })
    : [];
  const cloudBranches = cloud.ok
    ? cloud.stdout
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [ref, ts, subject] = l.split('\x1f');
          return { ref, name: ref.replace(/^origin\//, ''), time: Number(ts) * 1000, subject };
        })
    : [];
  return { commits, cloudBranches };
}

module.exports = { git, hasGit, parseStatus, parseGithubRemote, bucketWeeks, gitSummary, gitDetail, WEEKS };
