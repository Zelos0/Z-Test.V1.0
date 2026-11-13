'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseHot, cleanValue, findProjectDirs } = require('../app/lib/scanner');
const { parseStatus, parseGithubRemote, bucketWeeks } = require('../app/lib/git');
const { applyUpdate, defaults } = require('../app/lib/config');
const { driveLabel } = require('../app/lib/util');
const { missingRepos } = require('../app/lib/sync');

test('parseHot reads German SPINE bullets with continuation lines and placeholders', () => {
  const hot = parseHot(
    [
      '# HOT.md',
      '',
      '- Aktueller Fokus: SPINE-Setup für',
      '  dieses Projekt',
      '- Letzter abgeschlossener Schritt: `AGENTS.md` angelegt',
      '- Nächster Schritt: [vom Nutzer zu ergänzen]',
      '- Offene Blocker/Fragen: Dateinamen ohne Endung',
      '- Verweis: AGENTS.md',
    ].join('\r\n'),
  );
  assert.equal(hot.focus, 'SPINE-Setup für dieses Projekt');
  assert.equal(hot.last, 'AGENTS.md angelegt');
  assert.equal(hot.next, '');
  assert.equal(hot.blockers, 'Dateinamen ohne Endung');
});

test('parseHot accepts English and bold keys', () => {
  const hot = parseHot('- **Current focus**: ship v1\n- **Next step**: tests');
  assert.equal(hot.focus, 'ship v1');
  assert.equal(hot.next, 'tests');
});

test('cleanValue treats placeholders as empty', () => {
  assert.equal(cleanValue('[offen]'), '');
  assert.equal(cleanValue('—'), '');
  assert.equal(cleanValue('  a   b '), 'a b');
});

test('parseStatus counts changes, untracked, ahead/behind', () => {
  const st = parseStatus(
    ['# branch.oid abc', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -3', '1 .M N... 100644 100644 100644 a b f.txt', '? new.txt', '? other.txt', 'u UU N... x'].join('\n'),
  );
  assert.deepEqual(
    { b: st.branch, u: st.upstream, a: st.ahead, be: st.behind, c: st.changes, un: st.untracked, co: st.conflicts },
    { b: 'main', u: 'origin/main', a: 2, be: 3, c: 1, un: 2, co: 1 },
  );
  assert.equal(parseStatus('# branch.head (detached)\n').detached, true);
});

test('parseGithubRemote handles https, ssh and strips credentials', () => {
  assert.equal(parseGithubRemote('https://github.com/Zelos0/Z-Test.V1.0.git').nameWithOwner, 'Zelos0/Z-Test.V1.0');
  assert.equal(parseGithubRemote('git@github.com:zelos0/repo.git').url, 'https://github.com/zelos0/repo');
  const withToken = parseGithubRemote('https://x-access-token:SECRET@github.com/a/b');
  assert.equal(withToken.url, 'https://github.com/a/b');
  assert.ok(!JSON.stringify(withToken).includes('SECRET'));
  assert.equal(parseGithubRemote('https://gitlab.com/a/b'), null);
});

test('bucketWeeks puts commits into 12 weekly buckets, newest last', () => {
  const now = Date.UTC(2026, 10, 13);
  const s = (days) => (now - days * 86_400_000) / 1000;
  const b = bucketWeeks([s(0.5), s(1), s(8), s(83), s(200)], now);
  assert.equal(b.length, 12);
  assert.equal(b[11], 2);
  assert.equal(b[10], 1);
  assert.equal(b[0], 1);
  assert.equal(b.reduce((x, y) => x + y), 4);
});

test('driveLabel finds the drive letter', () => {
  assert.equal(driveLabel('H:\\Projekte'), 'H:');
  assert.equal(driveLabel('h:/x'), 'H:');
  assert.equal(driveLabel('/tmp/demo/D:/Archiv'), 'D:');
  assert.equal(driveLabel('/home/me/Projekte'), 'PR');
});

test('applyUpdate validates settings', () => {
  const cfg = defaults();
  const abs = path.resolve('/tmp/x');
  assert.ok(applyUpdate(cfg, { roots: [] }).error);
  assert.ok(applyUpdate(cfg, { roots: ['relative/path'] }).error);
  assert.ok(applyUpdate(cfg, { editor: 'code & calc' }).error);
  assert.ok(applyUpdate(cfg, { maxMePath: `${abs}"&calc` }).error);
  assert.ok(applyUpdate(cfg, { scanDepth: 3 }).error);
  assert.ok(applyUpdate(cfg, { sync: { intervalMinutes: -1 } }).error);
  assert.ok(applyUpdate(cfg, { github: { owners: ['bad/owner'] } }).error);
  const ok = applyUpdate(cfg, { roots: [abs, abs], editor: 'cursor', scanDepth: 2, sync: { autoPull: false }, github: { owners: ['zelos0'] } });
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.cfg.roots, [abs]);
  assert.equal(ok.cfg.editor, 'cursor');
  assert.equal(ok.cfg.sync.autoPull, false);
  assert.equal(ok.cfg.sync.onStart, true, 'untouched keys survive');
  assert.notEqual(ok.cfg, cfg, 'does not mutate the original');
});

test('findProjectDirs: depth 1 lists every folder, depth 2 opens marker-less group folders', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-find-'));
  fs.mkdirSync(path.join(root, 'app'));
  fs.writeFileSync(path.join(root, 'app', 'package.json'), '{}');
  fs.mkdirSync(path.join(root, 'Kunden', 'acme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Kunden', 'acme', 'index.html'), '');
  fs.mkdirSync(path.join(root, 'Musik', 'Album'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Musik', 'cover.jpg'), '');
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, '$RECYCLE.BIN'));

  const d1 = findProjectDirs(root, 1).map((f) => path.relative(root, f.dir)).sort();
  assert.deepEqual(d1, ['Kunden', 'Musik', 'app']);
  const d2 = findProjectDirs(root, 2).map((f) => `${f.group || ''}|${path.relative(root, f.dir)}`).sort();
  assert.deepEqual(d2, [`Kunden|${path.join('Kunden', 'acme')}`, '|Musik', '|app']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('missingRepos matches case-insensitively against local remotes', () => {
  const repos = [{ nameWithOwner: 'Zelos0/A' }, { nameWithOwner: 'zelos0/b' }];
  const projects = [{ git: { remote: { nameWithOwner: 'zelos0/a' } } }, { git: null }];
  assert.deepEqual(missingRepos(repos, projects).map((r) => r.nameWithOwner), ['zelos0/b']);
});
