'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { run, pLimit } = require('./util');
const { git } = require('./git');

const NWO_RE = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

/** gh CLI state: is it installed, is it logged in, which account. */
async function githubStatus() {
  const auth = await run('gh', ['auth', 'status'], { timeout: 8000 });
  if (auth.error === 'ENOENT') return { available: false, authed: false, user: null };
  if (!auth.ok) return { available: true, authed: false, user: null };
  const who = await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 10000 });
  return { available: true, authed: true, user: who.ok ? who.stdout.trim() : null };
}

/** Lists repos of the logged-in account (plus configured owners/orgs). */
async function listGithubRepos(cfg) {
  const owners = cfg.github?.owners?.length ? cfg.github.owners : [null];
  const fields = 'nameWithOwner,name,url,description,pushedAt,isArchived,isFork,isPrivate';
  const all = [];
  for (const owner of owners) {
    const args = ['repo', 'list', ...(owner ? [owner] : []), '--limit', '400', '--json', fields];
    const res = await run('gh', args, { timeout: 30000 });
    if (!res.ok) throw new Error(`gh repo list fehlgeschlagen${owner ? ` (${owner})` : ''}: ${res.stderr.trim().slice(0, 200)}`);
    all.push(...JSON.parse(res.stdout || '[]'));
  }
  return all.filter(
    (r) => (cfg.github?.includeArchived || !r.isArchived) && (cfg.github?.includeForks || !r.isFork),
  );
}

/** Repos on GitHub that have no local clone under any root. */
function missingRepos(repos, projects) {
  const local = new Set(
    projects.filter((p) => p.git?.remote).map((p) => p.git.remote.nameWithOwner.toLowerCase()),
  );
  return repos.filter((r) => !local.has(r.nameWithOwner.toLowerCase()));
}

async function cloneRepo(nameWithOwner, rootDir) {
  if (!NWO_RE.test(nameWithOwner)) throw new Error('Ungültiger Repository-Name.');
  const name = nameWithOwner.split('/')[1];
  const target = path.join(rootDir, name);
  if (fs.existsSync(target)) throw new Error(`Ordner existiert bereits: ${target}`);
  fs.mkdirSync(rootDir, { recursive: true });
  const res = await run('gh', ['repo', 'clone', nameWithOwner, target], {
    timeout: 15 * 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
  });
  if (!res.ok) throw new Error(`Klonen fehlgeschlagen: ${res.stderr.trim().slice(0, 300)}`);
  return target;
}

/**
 * Fetches one repo and fast-forwards it when that is provably safe:
 * clean working tree, upstream set, behind > 0, not ahead. Never merges or rebases.
 */
async function syncProject(project, cfg) {
  const p = project;
  if (!p.git || p.git.error || !p.git.hasRemote) return { id: p.id, skipped: 'kein Remote' };
  const opts = { trust: cfg.git?.trustRoots !== false };
  const fetch = await git(p.path, ['fetch', '--prune', '--quiet'], { ...opts, timeout: 90_000 });
  if (!fetch.ok) return { id: p.id, error: `fetch: ${fetch.stderr.trim().split('\n').pop() || fetch.error}` };
  if (!cfg.sync?.autoPull || !p.git.upstream) return { id: p.id, fetched: true };

  const st = await git(p.path, ['status', '--porcelain=v2', '--branch'], opts);
  const ab = /# branch\.ab \+(\d+) -(\d+)/.exec(st.stdout);
  const dirty = st.stdout.split('\n').some((l) => /^[12u?] /.test(l));
  const ahead = ab ? Number(ab[1]) : 0;
  const behind = ab ? Number(ab[2]) : 0;
  if (dirty || ahead > 0 || behind === 0) return { id: p.id, fetched: true, pulled: false };
  const ff = await git(p.path, ['merge', '--ff-only', '--quiet', '@{u}'], { ...opts, timeout: 60_000 });
  return ff.ok ? { id: p.id, fetched: true, pulled: behind } : { id: p.id, error: 'Fast-Forward nicht möglich' };
}

async function syncAll(projects, cfg, onProgress = () => {}) {
  const limit = pLimit(3);
  let done = 0;
  const targets = projects.filter((p) => p.git && !p.git.error && p.git.hasRemote);
  const results = await Promise.all(
    targets.map((p) =>
      limit(async () => {
        const r = await syncProject(p, cfg);
        onProgress(++done, targets.length, p.name);
        return r;
      }),
    ),
  );
  return results;
}

module.exports = { githubStatus, listGithubRepos, missingRepos, cloneRepo, syncProject, syncAll, NWO_RE };
