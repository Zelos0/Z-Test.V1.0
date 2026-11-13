'use strict';

(() => {
  const TOKEN = document.querySelector('meta[name="hub-token"]').content;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const DAY = 86_400_000;

  // ---------- tiny DOM helpers (file contents are always inserted as text, never HTML) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
    return el;
  }
  function icon(name, cls) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', cls ? `i ${cls}` : 'i');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }
  const store = {
    get(k) {
      try {
        return localStorage.getItem(`hub.${k}`);
      } catch {
        return null;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(`hub.${k}`, v);
      } catch {
        /* storage blocked: preference just isn't remembered */
      }
    },
  };

  async function api(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(path, {
      method,
      headers: { 'X-Hub-Token': TOKEN, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (raw) {
      if (!res.ok) throw new Error(`Fehler ${res.status}`);
      return res.text();
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }

  // ---------- formatting ----------
  function rel(ms) {
    if (!ms) return '—';
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60_000);
    if (min < 1) return 'gerade eben';
    if (min < 60) return `vor ${min} Min.`;
    const hrs = Math.round(min / 60);
    if (hrs < 24) return `vor ${hrs} Std.`;
    const days = Math.round(hrs / 24);
    if (days === 1) return 'gestern';
    if (days < 7) return `vor ${days} Tagen`;
    if (days < 60) return `vor ${Math.round(days / 7)} Wo.`;
    return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  const abs = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const sep = () => h('span', { class: 'sep', 'aria-hidden': 'true', text: '·' });

  // ---------- state ----------
  const S = {
    data: null,
    version: 0,
    view: store.get('view') || 'all',
    root: null,
    stack: null,
    q: '',
    sort: store.get('sort') || 'recent',
    selected: null,
    detailId: null,
    detail: null,
    offline: false,
  };
  const projects = () => S.data?.projects || [];
  const isDirty = (p) => p.git && !p.git.error && p.git.changes + p.git.untracked + p.git.conflicts > 0;
  const isUnsynced = (p) => p.git && !p.git.error && (p.git.ahead > 0 || p.git.behind > 0);

  const VIEWS = [
    { id: 'all', label: 'Alle Projekte', icon: 'folder', test: () => true },
    { id: 'week', label: 'Diese Woche aktiv', icon: 'activity', test: (p) => Date.now() - p.lastActivity < 7 * DAY },
    { id: 'dirty', label: 'Offene Änderungen', icon: 'edit', test: isDirty },
    { id: 'unsynced', label: 'Nicht synchron', icon: 'arrows', test: isUnsynced },
    { id: 'cloud', label: 'Cloud-Branches', icon: 'cloud', test: (p) => p.git?.cloudBranches > 0 },
    { id: 'nospine', label: 'Ohne volles SPINE', icon: 'spine', test: (p) => p.spine.level !== 'full' },
    { id: 'github', label: 'Nur auf GitHub', icon: 'download', remote: true },
  ];
  const viewDef = () => VIEWS.find((v) => v.id === S.view) || VIEWS[0];

  function matchesQuery(p) {
    if (!S.q) return true;
    const hay = [
      p.name, p.group, p.description, p.path, p.pm, p.flavor,
      p.spine?.hotParsed?.focus, p.spine?.hotParsed?.next,
      ...(p.stack || []), p.git?.branch, p.git?.remote?.nameWithOwner,
      p.nameWithOwner,
    ].filter(Boolean).join(' ').toLowerCase();
    return S.q.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t));
  }

  function visibleItems() {
    const v = viewDef();
    if (v.remote) {
      return (S.data?.github?.missing || []).filter(matchesQuery).sort((a, b) => (b.pushedAt || 0) - (a.pushedAt || 0));
    }
    const SP = { full: 0, partial: 1, none: 2 };
    const list = projects().filter(
      (p) => v.test(p) && (!S.root || p.root === S.root) && (!S.stack || p.stack.includes(S.stack)) && matchesQuery(p),
    );
    const byRecent = (a, b) => b.lastActivity - a.lastActivity;
    const sorters = {
      recent: byRecent,
      name: (a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }),
      changes: (a, b) => (isDirty(b) ? b.git.changes + b.git.untracked : 0) - (isDirty(a) ? a.git.changes + a.git.untracked : 0) || byRecent(a, b),
      spine: (a, b) => SP[a.spine.level] - SP[b.spine.level] || byRecent(a, b),
    };
    return list.sort(sorters[S.sort] || byRecent);
  }

  // ---------- rail ----------
  function renderRail() {
    const all = projects();
    const gh = S.data?.github || {};
    const views = $('#views');
    views.replaceChildren(
      ...VIEWS.map((v) => {
        const n = v.remote ? (gh.authed ? gh.missing.length : null) : all.filter(v.test).length;
        const btn = h(
          'button',
          {
            class: `nav-item${n === 0 ? ' is-zero' : ''}`,
            type: 'button',
            'aria-current': S.view === v.id ? 'true' : null,
            onclick: () => setView(v.id),
          },
          icon(v.icon),
          h('span', { class: 'grow', text: v.label }),
          h('span', { class: 'count', text: n == null ? '–' : String(n) }),
        );
        return h('li', null, btn);
      }),
    );

    const roots = $('#roots');
    roots.replaceChildren(
      ...(S.data?.roots || []).map((r) => {
        const seg = r.path.split(/[\\/]/).filter(Boolean);
        const name = seg.length > 1 ? seg[seg.length - 1] : r.path;
        const btn = h(
          'button',
          {
            class: `nav-item drive${r.online ? '' : ' offline'}`,
            type: 'button',
            'aria-current': S.root === r.path ? 'true' : null,
            title: r.online ? `${r.path} – nach diesem Laufwerk filtern` : `${r.path} ist nicht erreichbar`,
            onclick: () => {
              S.root = S.root === r.path ? null : r.path;
              closeRail();
              renderAll();
            },
          },
          h('span', { class: 'drive-letter', text: r.label }),
          h('span', { class: 'drive-text' }, h('b', { text: r.online ? name : 'nicht verbunden' }), h('span', null, h('span', { dir: 'ltr', text: r.path }))),
          h('span', { class: 'count', text: r.online ? String(all.filter((p) => p.root === r.path).length) : '–' }),
        );
        return h('li', null, btn);
      }),
    );

    const counts = new Map();
    for (const p of all) for (const t of p.stack) counts.set(t, (counts.get(t) || 0) + 1);
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 9);
    const stackSec = $('#stacks').closest('.rail-sec');
    stackSec.hidden = top.length === 0;
    $('#stacks').replaceChildren(
      ...top.map(([t, n]) =>
        h(
          'li',
          null,
          h(
            'button',
            {
              class: 'nav-item',
              type: 'button',
              'aria-current': S.stack === t ? 'true' : null,
              onclick: () => {
                S.stack = S.stack === t ? null : t;
                closeRail();
                renderAll();
              },
            },
            h('span', { class: 'grow', text: t }),
            h('span', { class: 'count', text: String(n) }),
          ),
        ),
      ),
    );
    renderStatus();
  }

  function renderStatus() {
    const d = S.data;
    const el = $('#scanStatus');
    const syncBtn = $('#syncBtn');
    if (!d) return;
    const busy = d.busy || {};
    syncBtn.disabled = Boolean(busy.syncing);
    syncBtn.classList.toggle('is-busy', Boolean(busy.syncing));
    if (S.offline) {
      el.replaceChildren(h('b', { text: 'Server nicht erreichbar' }), h('br'), 'Läuft der Projekt-Hub noch?');
      return;
    }
    const lines = [];
    if (busy.syncing) lines.push([h('b', { text: 'Synchronisiere …' }), h('br'), busy.progress || '']);
    else if (busy.scanning) lines.push([h('b', { text: 'Scanne Laufwerke …' })]);
    else if (d.scannedAt) lines.push([h('b', { text: `Gescannt ${rel(d.scannedAt)}` }), ` · ${d.scanMs} ms`]);
    if (!busy.syncing && d.lastSync) {
      const s = d.lastSync;
      const parts = [`${s.pulled} aktualisiert`];
      if (s.cloned.length) parts.push(`${s.cloned.length} geklont`);
      if (s.errors.length) parts.push(plural(s.errors.length, 'Fehler', 'Fehler'));
      lines.push([h('br'), `Sync ${rel(s.at)}: ${parts.join(', ')}`]);
    }
    el.replaceChildren(...lines.flat());
    el.title = d.lastSync?.errors?.length ? d.lastSync.errors.map((e) => `${e.name}: ${e.error}`).join('\n') : '';
  }

  // ---------- header ----------
  function renderHeader(items) {
    const v = viewDef();
    const filters = [S.root && (S.data.roots.find((r) => r.path === S.root)?.label || S.root), S.stack].filter(Boolean);
    $('#viewTitle').textContent = filters.length ? `${v.label} · ${filters.join(' · ')}` : v.label;

    const all = projects();
    const online = (S.data?.roots || []).filter((r) => r.online).length;
    const full = all.filter((p) => p.spine.level === 'full').length;
    const dirty = all.filter(isDirty).length;
    const week = all.filter((p) => Date.now() - p.lastActivity < 7 * DAY).length;
    const sum = $('#summary');
    const b = (n) => h('b', { text: String(n) });
    const parts = [
      [b(all.length), ` ${all.length === 1 ? 'Projekt' : 'Projekte'} auf `, b(online), ` ${online === 1 ? 'Laufwerk' : 'Laufwerken'}`],
      [b(full), ' mit SPINE'],
      [b(dirty), ' mit offenen Änderungen'],
      [b(week), ' diese Woche aktiv'],
    ];
    if (items.length !== (v.remote ? items.length : all.length) || S.q) parts.push([b(items.length), ' angezeigt']);
    sum.replaceChildren(...parts.flatMap((p, i) => [...(i ? [' ', sep(), ' '] : []), h('span', { class: 'seg' }, ...p)]));

    const offline = (S.data?.roots || []).filter((r) => !r.online);
    const banner = $('#banner');
    if (S.offline) {
      banner.hidden = false;
      banner.replaceChildren(icon('sync'), h('span', { text: 'Verbindung zum lokalen Server verloren – starte „Projekt-Hub“ neu. Ich versuche es weiter.' }));
    } else if (offline.length) {
      banner.hidden = false;
      banner.replaceChildren(
        icon('folder'),
        h('span', null, h('span', { class: 'mono', text: offline.map((r) => r.path).join(', ') }), ` ${offline.length === 1 ? 'ist' : 'sind'} nicht erreichbar – Laufwerk verbunden?`),
      );
    } else banner.hidden = true;
  }

  // ---------- rows ----------
  function meter(spine, small) {
    const labels = [['AGENTS.md', spine.agents], ['CLAUDE.md', spine.claude], ['HOT.md', spine.hot]];
    const title = labels.map(([n, on]) => `${n} ${on ? '✓' : '–'}`).join('  ·  ');
    return h(
      'span',
      { class: `meter${spine.level === 'partial' ? ' is-partial' : ''}${small ? ' sm' : ''}`, title, role: 'img', 'aria-label': `SPINE: ${title}` },
      ...labels.map(([, on]) => h('i', { class: on ? 'on' : null })),
    );
  }

  function pulse(arr, total) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'pulse');
    svg.setAttribute('viewBox', '0 0 84 22');
    svg.setAttribute('role', 'img');
    const label = `${plural(total, 'Commit', 'Commits')} in 12 Wochen`;
    svg.setAttribute('aria-label', label);
    const t = document.createElementNS(NS, 'title');
    t.textContent = label;
    svg.append(t);
    const max = Math.max(1, ...arr);
    arr.forEach((v, i) => {
      const r = document.createElementNS(NS, 'rect');
      const hgt = v ? Math.max(3, Math.round(Math.sqrt(v / max) * 21)) : 2;
      r.setAttribute('x', String(i * 7));
      r.setAttribute('y', String(22 - hgt));
      r.setAttribute('width', '5');
      r.setAttribute('height', String(hgt));
      r.setAttribute('rx', '1.2');
      if (!v) r.setAttribute('class', 'zero');
      else if (i === arr.length - 1) r.setAttribute('class', 'now');
      svg.append(r);
    });
    return svg;
  }

  function gitChips(g) {
    const chips = [];
    const n = g.changes + g.untracked;
    if (g.conflicts) chips.push(h('span', { class: 'chip danger', title: 'Merge-Konflikte', text: `!${g.conflicts}` }));
    if (n) chips.push(h('span', { class: 'chip warn', title: `${g.changes} geändert, ${g.untracked} neu`, text: `●${n}` }));
    if (g.ahead) chips.push(h('span', { class: 'chip info', title: `${g.ahead} Commits noch nicht gepusht`, text: `↑${g.ahead}` }));
    if (g.behind) chips.push(h('span', { class: 'chip info', title: `${g.behind} Commits auf dem Remote`, text: `↓${g.behind}` }));
    if (g.cloudBranches) chips.push(h('span', { class: 'chip ok', title: `${g.cloudBranches} Cloud-Session-Branches (origin/claude/*)`, text: `☁${g.cloudBranches}` }));
    return chips;
  }

  function gitCell(p) {
    const g = p.git;
    if (!g) return h('div', { class: 'cell-git' }, h('span', { class: 'none', text: p.flavor === 'FILES' && !p.empty ? 'Dateiprojekt' : 'kein Git' }));
    if (g.error) {
      const msg = { 'dubious-ownership': 'Besitzer abweichend', 'git-missing': 'Git fehlt' }[g.error] || 'Git-Fehler';
      return h('div', { class: 'cell-git' }, h('span', { class: 'chip danger', text: msg }));
    }
    return h('div', { class: 'cell-git' }, icon('branch'), h('span', { class: 'br', text: g.branch || (g.detached ? 'detached' : '—'), title: g.upstream || '' }), ...gitChips(g));
  }

  function subLine(p) {
    const focus = p.spine?.hotParsed?.focus;
    if (focus) return h('div', { class: 'p-sub', title: focus }, h('span', { class: 'k', text: 'Fokus' }), focus);
    if (p.description) return h('div', { class: 'p-sub', title: p.description, text: p.description });
    return h('div', { class: 'p-sub is-empty', text: p.empty ? 'Leerer Ordner' : 'Keine Beschreibung' });
  }

  function quickBtn(name, label, onclick, primary) {
    return h(
      'button',
      {
        class: `icon-btn${primary ? ' primary' : ''}`,
        type: 'button',
        title: label,
        'aria-label': label,
        onclick: (e) => {
          e.stopPropagation();
          onclick();
        },
      },
      icon(name),
    );
  }

  function projectRow(p) {
    const compactBits = [meter(p.spine, true)];
    if (p.stack.length) compactBits.push(h('span', { text: p.stack[0] }));
    if (p.git && !p.git.error) compactBits.push(h('span', { text: p.git.branch || 'detached' }), ...gitChips(p.git));
    const li = h(
      'li',
      {
        class: `row${S.selected === p.id ? ' is-selected' : ''}`,
        tabindex: '0',
        'data-id': p.id,
        'aria-current': S.selected === p.id ? 'true' : null,
        onclick: () => select(p.id, true),
        onkeydown: (e) => {
          if (e.key === 'Enter' && e.target === li) select(p.id, true);
        },
      },
      h(
        'div',
        { class: 'cell-name' },
        h('div', { class: 'p-name' }, p.group ? h('span', { class: 'grp', text: `${p.group} /` }) : null, h('span', { class: 'nm', text: p.name })),
        subLine(p),
        h('div', { class: 'compact' }, ...compactBits),
      ),
      h('div', { class: 'cell-stack', title: p.stack.join(' · ') || null }, p.stack.length ? p.stack.join(' · ') : '—', p.pm ? h('span', { class: 'pm', text: ` ${p.pm}` }) : null),
      gitCell(p),
      h('div', { class: 'cell-spine' }, meter(p.spine)),
      h('div', { class: 'cell-pulse' }, p.git && !p.git.error ? pulse(p.git.pulse, p.git.commits12w) : null),
      h('div', { class: 'cell-time', title: abs(p.lastActivity), text: rel(p.lastActivity) }),
      h(
        'div',
        { class: 'quick' },
        quickBtn('spark', 'Claude Code öffnen (c)', () => act(p, 'claude'), true),
        quickBtn('code', 'Im Editor öffnen (e)', () => act(p, 'editor')),
        quickBtn('folder', 'Im Explorer öffnen (o)', () => act(p, 'explorer')),
      ),
    );
    return li;
  }

  function remoteRow(r) {
    const [owner] = r.nameWithOwner.split('/');
    return h(
      'li',
      { class: 'row remote', tabindex: '0', 'data-id': r.nameWithOwner },
      h(
        'div',
        { class: 'cell-name' },
        h('div', { class: 'p-name' }, h('span', { class: 'grp', text: `${owner} /` }), h('span', { class: 'nm', text: r.name })),
        h('div', { class: `p-sub${r.description ? '' : ' is-empty'}`, text: r.description || 'Keine Beschreibung' }),
      ),
      h('div', { class: 'cell-stack', text: r.isPrivate ? 'privat' : 'öffentlich' }),
      h('div', { class: 'cell-git' }, icon('cloud'), h('span', { class: 'br', title: abs(r.pushedAt), text: `gepusht ${rel(r.pushedAt)}` })),
      h('div', { class: 'cell-spine' }),
      h('div', { class: 'cell-pulse' }),
      h('div', { class: 'cell-time' }),
      h(
        'div',
        { class: 'quick' },
        quickBtn('download', `Nach ${S.data.roots[0]?.path || 'H:'} klonen`, () => cloneRepo(r), true),
        h('a', { class: 'icon-btn', href: r.url, target: '_blank', rel: 'noopener noreferrer', title: 'Auf GitHub ansehen', 'aria-label': 'Auf GitHub ansehen', onclick: (e) => e.stopPropagation() }, icon('external')),
      ),
    );
  }

  function skeletonRows(n) {
    return Array.from({ length: n }, () =>
      h(
        'li',
        { class: 'row skel', 'aria-hidden': 'true' },
        h('div', null, h('div', { class: 'skel-bar w1' }), h('div', { class: 'skel-bar w2' })),
        h('div', { class: 'cell-stack' }, h('div', { class: 'skel-bar w3' })),
        h('div', { class: 'cell-git' }, h('div', { class: 'skel-bar w3' })),
        h('div', { class: 'cell-spine' }),
        h('div', { class: 'cell-pulse' }),
        h('div', { class: 'cell-time' }),
      ),
    );
  }

  function emptyState(title, text, ...actions) {
    return [h('h2', { text: title }), h('p', null, ...[].concat(text)), actions.length ? h('div', { class: 'sec-actions' }, ...actions) : null];
  }
  const code = (t) => h('code', { text: t });

  function renderList() {
    const items = visibleItems();
    renderHeader(items);
    const list = $('#list');
    const empty = $('#empty');
    const hadFocus = document.activeElement?.closest?.('.row')?.dataset.id;
    const v = viewDef();
    const d = S.data;
    $('#listHead').hidden = false;

    if (!d) {
      list.replaceChildren(...skeletonRows(6));
      empty.hidden = true;
      return;
    }
    if (items.length) {
      list.replaceChildren(...items.map((it) => (v.remote ? remoteRow(it) : projectRow(it))));
      empty.hidden = true;
      if (hadFocus) list.querySelector(`[data-id="${CSS.escape(hadFocus)}"]`)?.focus({ preventScroll: true });
      return;
    }
    list.replaceChildren();
    if (!v.remote && !projects().length && d.busy?.scanning) {
      list.replaceChildren(...skeletonRows(6));
      empty.hidden = true;
      return;
    }
    $('#listHead').hidden = true;
    empty.hidden = false;
    const gh = d.github || {};
    const firstRoot = d.roots[0]?.path || 'H:\\Projekte';
    let content;
    if (v.remote && gh.available === false) {
      content = emptyState('GitHub CLI fehlt', ['Installiere sie mit ', code('winget install GitHub.cli'), ' und melde dich mit ', code('gh auth login'), ' an. Danach zeigt diese Ansicht alle Repos, die noch keinen Ordner auf deinen Laufwerken haben.'], recheckBtn());
    } else if (v.remote && !gh.authed) {
      content = emptyState('Bei GitHub anmelden', ['Führe einmal ', code('gh auth login'), ' in einer Konsole aus. Danach erscheinen hier alle Repos ohne lokalen Ordner.'], recheckBtn());
    } else if (v.remote) {
      content = emptyState('Alles lokal', `Jedes Repo${gh.user ? ` von ${gh.user}` : ''} hat bereits einen Ordner.`);
    } else if (!d.roots.some((r) => r.online)) {
      content = emptyState('Kein Laufwerk erreichbar', [code(d.roots.map((r) => r.path).join(', ') || firstRoot), ' ist nicht verbunden. Schließe das Laufwerk an oder ändere die Wurzelordner.'], h('button', { class: 'btn', type: 'button', onclick: openSettings, text: 'Einstellungen öffnen' }));
    } else if (!projects().length) {
      content = emptyState('Noch keine Projekte', ['Jeder Ordner in ', code(firstRoot), ' erscheint hier automatisch.'], h('button', { class: 'btn primary', type: 'button', onclick: openNew }, icon('plus'), 'Neues Projekt'));
    } else {
      content = emptyState('Keine Treffer', 'Für diese Suche und Filter gibt es keine Projekte.', h('button', { class: 'btn', type: 'button', onclick: resetFilters, text: 'Filter zurücksetzen' }));
    }
    empty.replaceChildren(...content.filter(Boolean));
  }

  function recheckBtn() {
    return h('button', {
      class: 'btn',
      type: 'button',
      text: 'Erneut prüfen',
      onclick: async (e) => {
        e.currentTarget.disabled = true;
        await api('/api/github/refresh', { method: 'POST' }).catch((err) => toast(err.message, 'err'));
        await refresh(true);
      },
    });
  }

  // ---------- detail panel ----------
  function select(id, open) {
    S.selected = id;
    document.querySelectorAll('.row.is-selected').forEach((r) => {
      r.classList.remove('is-selected');
      r.removeAttribute('aria-current');
    });
    const row = document.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    if (row) {
      row.classList.add('is-selected');
      row.setAttribute('aria-current', 'true');
    }
    if (open || S.detailId) openDetail(id);
  }

  async function openDetail(id) {
    const p = projects().find((x) => x.id === id);
    if (!p) return;
    S.detailId = id;
    app.classList.add('has-detail');
    const panel = $('#detail');
    panel.hidden = false;
    if (!S.detail || S.detail.project.id !== id) {
      S.detail = { project: p, commits: null, cloudBranches: null, readme: null };
      renderDetail();
    }
    try {
      const d = await api(`/api/project/${id}`);
      if (S.detailId !== id) return;
      S.detail = d;
      renderDetail();
    } catch (err) {
      if (S.detailId === id) toast(err.message, 'err');
    }
  }

  function closeDetail() {
    S.detailId = null;
    S.detail = null;
    app.classList.remove('has-detail');
    $('#detail').hidden = true;
    document.querySelector(`.row[data-id="${CSS.escape(S.selected || '')}"]`)?.focus({ preventScroll: true });
  }

  function actButton(iconName, label, onclick, { primary, key, disabled, title } = {}) {
    return h(
      'button',
      { class: `act${primary ? ' primary' : ''}`, type: 'button', onclick, disabled, title },
      h('span', { class: 'act-top' }, icon(iconName), key ? h('kbd', { text: key }) : null),
      label,
    );
  }

  function renderDetail() {
    const panel = $('#detail');
    const d = S.detail;
    if (!d) return;
    const p = projects().find((x) => x.id === d.project.id) || d.project;
    const g = p.git;
    const settings = S.data.settings || {};
    const editorName = settings.editor === 'code' ? 'VS Code' : settings.editor;
    const rootLabel = S.data.roots.find((r) => r.path === p.root)?.label || '';

    const head = h(
      'div',
      { class: 'd-head' },
      h(
        'div',
        { class: 'd-top' },
        h('div', { class: 'crumb' }, h('span', { class: 'drive-letter', text: rootLabel }), h('span', { class: 'path', title: p.path }, h('span', { dir: 'ltr', text: p.path }))),
        h('button', { class: 'icon-btn', type: 'button', title: 'Pfad kopieren', 'aria-label': 'Pfad kopieren', onclick: () => copy(p.path, 'Pfad kopiert') }, icon('copy')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Schließen (Esc)', 'aria-label': 'Details schließen', onclick: closeDetail }, icon('x')),
      ),
      h('h2', { class: 'd-title', text: p.name }),
      h(
        'p',
        { class: 'd-meta' },
        ...[p.stack.join(' · ') || null, p.pm, p.flavor === 'CODE' ? 'Code-Projekt' : 'Dateiprojekt', p.group ? `Gruppe ${p.group}` : null]
          .filter(Boolean)
          .flatMap((t, i) => (i ? [sep(), t] : [t])),
      ),
    );

    const actions = [
      actButton('spark', 'Claude Code', () => act(p, 'claude'), { primary: true, key: 'c' }),
      actButton('code', editorName, () => act(p, 'editor'), { key: 'e' }),
      actButton('folder', 'Explorer', () => act(p, 'explorer'), { key: 'o' }),
      actButton('terminal', 'Terminal', () => act(p, 'terminal')),
    ];
    if (p.spine.level !== 'full') {
      actions.push(
        actButton('spine', 'SPINE einrichten', () => act(p, 'spine'), {
          disabled: !settings.maxMeAvailable,
          title: settings.maxMeAvailable ? `Startet Claude Code mit START.md aus ${settings.maxMePath}` : `MAX-ME nicht gefunden: ${settings.maxMePath || '(kein Pfad)'}`,
        }),
      );
    }
    if (g?.remote) {
      actions.push(h('a', { class: 'act', href: g.remote.url, target: '_blank', rel: 'noopener noreferrer' }, h('span', { class: 'act-top' }, icon('external')), 'GitHub'));
    }

    const secs = [];
    // Stand (HOT.md)
    const hp = p.spine.hotParsed;
    if (hp) {
      const rows = [
        ['Fokus', hp.focus],
        ['Zuletzt', hp.last],
        ['Als Nächstes', hp.next],
      ];
      if (hp.blockers) rows.push(['Blocker', hp.blockers, 'block']);
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label' }, 'Stand · HOT.md', h('span', { class: 'aside', title: abs(p.spine.hotUpdated), text: `aktualisiert ${rel(p.spine.hotUpdated)}` })),
          h('dl', { class: 'stand' }, ...rows.flatMap(([k, v, cls]) => [h('dt', { text: k }), h('dd', { class: v ? cls || null : 'open', text: v || 'offen' })])),
        ),
      );
    } else {
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label', text: 'Stand' }),
          h('p', { class: 'note' }, 'Kein Session-Snapshot. ', code('.snapshot/HOT.md'), ' entsteht mit „SPINE einrichten“ und hält fest, wo du stehst.'),
        ),
      );
    }
    // SPINE
    const check = (ok, name, extra) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), code(name), extra ? h('span', { class: 'extra', text: extra }) : null);
    secs.push(
      h(
        'section',
        { class: 'd-sec' },
        h('h3', { class: 'label' }, 'SPINE', h('span', { class: 'aside', text: { full: 'vollständig', partial: 'teilweise', none: 'nicht eingerichtet' }[p.spine.level] })),
        h(
          'ul',
          { class: 'checklist' },
          check(p.spine.agents, 'AGENTS.md', p.spine.unindexed ? 'Child-Index fehlt' : null),
          check(p.spine.claude, 'CLAUDE.md'),
          check(p.spine.extensions, 'EXTENSIONS.md'),
          check(p.spine.hot, '.snapshot/HOT.md'),
        ),
        p.spine.activeExtensions.length ? h('div', { class: 'ext-list', 'aria-label': 'Aktive Extensions' }, ...p.spine.activeExtensions.map((e) => h('span', { text: e }))) : null,
      ),
    );
    // Git
    if (g && !g.error) {
      const up = g.upstream
        ? [g.upstream, g.ahead ? `${g.ahead} voraus` : null, g.behind ? `${g.behind} zurück` : null, !g.ahead && !g.behind ? 'synchron' : null].filter(Boolean).join(' · ')
        : 'kein Upstream';
      const wt = g.changes + g.untracked + g.conflicts ? [g.changes ? `${g.changes} geändert` : null, g.untracked ? `${g.untracked} neu` : null, g.conflicts ? `${g.conflicts} Konflikte` : null].filter(Boolean).join(' · ') : 'sauber';
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label', text: 'Git' }),
          h(
            'dl',
            { class: 'kv' },
            h('dt', { text: 'Branch' }), h('dd', { class: 'mono', text: g.branch || 'detached' }),
            h('dt', { text: 'Upstream' }), h('dd', { class: 'mono', text: up }),
            h('dt', { text: 'Arbeitskopie' }), h('dd', { text: wt }),
            h('dt', { text: 'Remote' }),
            h('dd', null, g.remote ? h('a', { href: g.remote.url, target: '_blank', rel: 'noopener noreferrer', text: g.remote.nameWithOwner }) : g.hasRemote ? 'anderer Anbieter' : 'keiner'),
            h('dt', { text: 'Letzter Commit' }),
            h('dd', { title: abs(g.lastCommit?.time) }, g.lastCommit ? `${rel(g.lastCommit.time)} – ${g.lastCommit.subject}` : 'noch keiner'),
          ),
          g.hasRemote
            ? h('div', { class: 'sec-actions' }, h('button', { class: 'btn sm', type: 'button', onclick: (e) => syncOne(p, e.currentTarget) }, icon('sync'), 'Jetzt synchronisieren'))
            : null,
        ),
      );
    } else if (g?.error) {
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label', text: 'Git' }),
          h(
            'p',
            { class: 'note' },
            g.error === 'dubious-ownership'
              ? ['Git verweigert den Zugriff (Ordner gehört einem anderen Windows-Benutzer). Abhilfe: ', code(`git config --global --add safe.directory "${p.path.replace(/\\/g, '/')}"`)]
              : g.error === 'git-missing'
                ? ['Git ist nicht installiert: ', code('winget install Git.Git')]
                : 'Git-Status konnte nicht gelesen werden.',
          ),
        ),
      );
    }
    // Cloud sessions
    if (d.cloudBranches?.length) {
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label' }, 'Cloud-Sessions', h('span', { class: 'aside', text: 'origin/claude/*' })),
          h('p', { class: 'note' }, 'Arbeit aus Claude-Code-Cloud-Sessions, die noch nicht im Hauptzweig ist.'),
          h(
            'ul',
            { class: 'log' },
            ...d.cloudBranches.map((b) =>
              h('li', null, h('span', { class: 'msg mono', text: b.name, title: b.name }), h('span', { class: 'when', title: abs(b.time), text: rel(b.time) }), h('span', { class: 'meta', text: b.subject })),
            ),
          ),
        ),
      );
    }
    // Commits
    if (d.commits === null && g && !g.error) {
      secs.push(h('section', { class: 'd-sec' }, h('h3', { class: 'label', text: 'Letzte Commits' }), h('p', { class: 'note', text: 'Lade …' })));
    } else if (d.commits?.length) {
      secs.push(
        h(
          'section',
          { class: 'd-sec' },
          h('h3', { class: 'label', text: 'Letzte Commits' }),
          h(
            'ul',
            { class: 'log' },
            ...d.commits.map((c) =>
              h('li', null, h('span', { class: 'msg', title: c.subject, text: c.subject }), h('span', { class: 'when', title: abs(c.time), text: rel(c.time) }), h('span', { class: 'meta', text: `${c.hash} · ${c.author}` })),
            ),
          ),
        ),
      );
    }
    if (d.readme) secs.push(h('section', { class: 'd-sec' }, h('h3', { class: 'label', text: 'Beschreibung' }), h('p', { class: 'readme', text: d.readme })));

    const scrollTop = panel.scrollTop;
    panel.replaceChildren(head, h('div', { class: 'd-actions' }, ...actions), ...secs);
    panel.scrollTop = scrollTop;
  }

  // ---------- actions ----------
  const ACT_MSG = {
    claude: 'Claude Code wird geöffnet …',
    editor: 'Editor wird geöffnet …',
    explorer: 'Explorer geöffnet',
    terminal: 'Terminal geöffnet',
    spine: 'Claude Code startet START.md …',
  };
  async function act(p, action) {
    try {
      await api('/api/action', { method: 'POST', body: { id: p.id, action } });
      toast(ACT_MSG[action] || 'Erledigt', 'ok', p.name);
    } catch (err) {
      toast(err.message, 'err', p.name);
    }
  }
  async function syncOne(p, btn) {
    btn.disabled = true;
    btn.classList.add('is-busy');
    try {
      const res = await api('/api/action', { method: 'POST', body: { id: p.id, action: 'sync' } });
      const r = res.result || {};
      toast(r.pulled ? `${plural(r.pulled, 'Commit', 'Commits')} übernommen` : 'Remote geholt – nichts vorzuspulen', 'ok', p.name);
      await refresh(true);
      if (S.detailId === p.id) openDetail(p.id);
    } catch (err) {
      toast(err.message, 'err', p.name);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-busy');
    }
  }
  async function cloneRepo(r) {
    toast(`Klone ${r.nameWithOwner} …`, 'ok');
    try {
      const res = await api('/api/action', { method: 'POST', body: { repo: r.nameWithOwner, action: 'clone', rootIndex: 0 } });
      toast('Geklont', 'ok', r.nameWithOwner);
      await refresh(true);
      if (res.id) {
        setView('all');
        select(res.id, true);
      }
    } catch (err) {
      toast(err.message, 'err', r.nameWithOwner);
    }
  }
  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
      toast(msg, 'ok');
    } catch {
      toast('Zwischenablage nicht verfügbar', 'err');
    }
  }

  function toast(msg, kind = 'ok', sub) {
    const el = h('div', { class: `toast ${kind}` }, icon(kind === 'err' ? 'x' : 'check'), h('div', null, msg, sub ? h('small', { text: sub }) : null));
    $('#toasts').append(el);
    setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3200);
  }

  // ---------- navigation ----------
  function setView(id) {
    S.view = id;
    store.set('view', id);
    closeRail();
    renderAll();
    $('#main').scrollTop = 0;
  }
  function resetFilters() {
    S.root = null;
    S.stack = null;
    S.q = '';
    $('#q').value = '';
    setView('all');
  }
  function openRail() {
    app.classList.add('rail-open');
    $('#scrim').hidden = false;
  }
  function closeRail() {
    app.classList.remove('rail-open');
    $('#scrim').hidden = true;
  }

  function renderAll() {
    renderRail();
    renderList();
    if (S.detailId) {
      if (projects().some((p) => p.id === S.detailId)) renderDetail();
      else closeDetail();
    }
  }

  // ---------- polling ----------
  let pollTimer = null;
  async function refresh(force = false) {
    clearTimeout(pollTimer);
    try {
      const res = await api(`/api/state${!force && S.version ? `?since=${S.version}` : ''}`);
      const wasOffline = S.offline;
      S.offline = false;
      if (res.unchanged) {
        S.data.busy = res.busy;
        renderStatus();
        if (wasOffline) renderAll();
      } else {
        S.data = res;
        S.version = res.version;
        $('#brandSub').textContent = `lokal · v${res.app.version}`;
        renderAll();
      }
    } catch {
      S.offline = true;
      if (S.data) {
        renderStatus();
        renderHeader(visibleItems());
      }
    }
    const busy = S.data?.busy?.scanning || S.data?.busy?.syncing;
    const delay = S.offline ? 5000 : busy ? 1200 : document.hidden ? 60_000 : 15_000;
    pollTimer = setTimeout(refresh, delay);
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  // ---------- dialogs ----------
  function wireDialog(dlg) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
  }
  const newDlg = $('#newDlg');
  const setDlg = $('#settingsDlg');
  wireDialog(newDlg);
  wireDialog(setDlg);

  function openNew() {
    if (!S.data) return;
    const sel = $('#newRoot');
    sel.replaceChildren(...S.data.roots.map((r, i) => h('option', { value: String(i), disabled: r.online ? null : true, text: r.online ? r.path : `${r.path} (nicht verbunden)` })));
    const firstOnline = S.data.roots.findIndex((r) => r.online);
    sel.value = String(Math.max(0, firstOnline));
    const st = S.data.settings || {};
    const spine = $('#newSpine');
    spine.disabled = !st.maxMeAvailable;
    spine.checked = Boolean(st.maxMeAvailable);
    spine.closest('.check').classList.toggle('disabled', !st.maxMeAvailable);
    $('#newSpineHint').textContent = st.maxMeAvailable ? `Öffnet Claude Code mit START.md aus ${st.maxMePath}` : `MAX-ME nicht gefunden (${st.maxMePath || 'kein Pfad'}) – in den Einstellungen festlegen`;
    $('#newClaude').checked = false;
    $('#newName').value = '';
    $('#newError').hidden = true;
    updatePathHint();
    newDlg.showModal();
    $('#newName').focus();
  }
  function updatePathHint() {
    const root = S.data?.roots[Number($('#newRoot').value)]?.path || '';
    const sepChar = S.data?.app.platform === 'win32' ? '\\' : '/';
    const name = $('#newName').value.trim();
    $('#newPathHint').textContent = name ? `${root.replace(/[\\/]$/, '')}${sepChar}${name}` : `${root}${sepChar}…`;
  }
  $('#newName').addEventListener('input', updatePathHint);
  $('#newRoot').addEventListener('change', updatePathHint);
  $('#newSpine').addEventListener('change', (e) => {
    if (e.target.checked) $('#newClaude').checked = false;
  });
  $('#newClaude').addEventListener('change', (e) => {
    if (e.target.checked) $('#newSpine').checked = false;
  });
  $('#newForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#newError');
    const name = $('#newName').value.trim();
    if (!name) {
      err.textContent = 'Bitte einen Namen eingeben.';
      err.hidden = false;
      return;
    }
    const btn = $('#newSubmit');
    btn.disabled = true;
    try {
      const res = await api('/api/new', {
        method: 'POST',
        body: { name, rootIndex: Number($('#newRoot').value), git: $('#newGit').checked, spine: $('#newSpine').checked, openClaude: $('#newClaude').checked },
      });
      newDlg.close();
      toast('Projekt angelegt', 'ok', name);
      for (const n of res.notes || []) toast(n, 'err', name);
      await refresh(true);
      resetFilters();
      select(res.id, true);
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });

  async function openSettings() {
    closeRail();
    try {
      const { config, configPath } = await api('/api/config');
      $('#setPath').textContent = configPath;
      $('#setRoots').value = config.roots.join('\n');
      $('#setMaxMe').value = config.maxMePath || '';
      $('#setEditor').value = config.editor || 'code';
      $('#setDepth').value = String(config.scanDepth || 1);
      $('#setInterval').value = String(config.sync.intervalMinutes);
      $('#setOnStart').checked = config.sync.onStart;
      $('#setPull').checked = config.sync.autoPull;
      $('#setClone').checked = config.sync.autoCloneMissing;
      $('#setOwners').value = (config.github.owners || []).join(', ');
      $('#setError').hidden = true;
      setDlg.showModal();
    } catch (err) {
      toast(err.message, 'err');
    }
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/config', {
        method: 'POST',
        body: {
          roots: $('#setRoots').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
          maxMePath: $('#setMaxMe').value.trim(),
          editor: $('#setEditor').value.trim(),
          scanDepth: Number($('#setDepth').value),
          sync: {
            intervalMinutes: Number($('#setInterval').value),
            onStart: $('#setOnStart').checked,
            autoPull: $('#setPull').checked,
            autoCloneMissing: $('#setClone').checked,
          },
          github: { owners: $('#setOwners').value.split(',').map((s) => s.trim()).filter(Boolean) },
        },
      });
      setDlg.close();
      toast('Einstellungen gespeichert', 'ok');
      refresh(true);
    } catch (err) {
      $('#setError').textContent = err.message;
      $('#setError').hidden = false;
    }
  });
  $('#hubIndexBtn').addEventListener('click', async () => {
    try {
      const md = await api('/api/hub-index', { raw: true });
      await copy(md, `HUB-Index kopiert (${plural(Math.max(0, md.trim().split('\n').length - 2), 'Projekt', 'Projekte')})`);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  // ---------- theme ----------
  function effectiveTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function applyThemeIcon() {
    const dark = effectiveTheme() === 'dark';
    $('#themeBtn').replaceChildren(icon(dark ? 'sun' : 'moon'));
    $('#themeBtn').setAttribute('aria-label', dark ? 'Helles Farbschema' : 'Dunkles Farbschema');
  }
  const savedTheme = store.get('theme');
  if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
  applyThemeIcon();
  $('#themeBtn').addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
    applyThemeIcon();
  });

  // ---------- wiring ----------
  $('#q').addEventListener('input', (e) => {
    S.q = e.target.value.trim();
    renderList();
  });
  const sortSel = $('#sort');
  sortSel.value = S.sort;
  sortSel.addEventListener('change', () => {
    S.sort = sortSel.value;
    store.set('sort', S.sort);
    renderList();
  });
  $('#newBtn').addEventListener('click', openNew);
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#menuBtn').addEventListener('click', openRail);
  $('#railClose').addEventListener('click', closeRail);
  $('#scrim').addEventListener('click', closeRail);
  $('#syncBtn').addEventListener('click', async () => {
    try {
      await api('/api/sync', { method: 'POST' });
      toast('Synchronisierung läuft …', 'ok', S.data?.settings?.autoCloneMissing ? 'inkl. fehlender GitHub-Repos' : null);
      refresh(true);
    } catch (err) {
      toast(err.message, 'err');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'Escape') {
      if (typing && e.target.id === 'q') {
        if (S.q) {
          e.target.value = '';
          S.q = '';
          renderList();
        } else e.target.blur();
        return;
      }
      if (app.classList.contains('rail-open')) return closeRail();
      if (S.detailId) return closeDetail();
      return;
    }
    if (typing) {
      if (e.key === 'ArrowDown' && e.target.id === 'q') {
        e.preventDefault();
        move(1);
      }
      return;
    }
    const sel = projects().find((p) => p.id === S.selected);
    switch (e.key) {
      case '/':
        e.preventDefault();
        $('#q').focus();
        $('#q').select();
        break;
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        move(1);
        break;
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        move(-1);
        break;
      case 'Enter':
        if (S.selected && !e.target.closest('button, a')) select(S.selected, true);
        break;
      case 'c':
        if (sel) act(sel, 'claude');
        break;
      case 'e':
        if (sel) act(sel, 'editor');
        break;
      case 'o':
        if (sel) act(sel, 'explorer');
        break;
      case 'n':
        e.preventDefault();
        openNew();
        break;
      case 'r':
        api('/api/scan', { method: 'POST' }).then(() => {
          toast('Scanne neu …', 'ok');
          refresh(true);
        }, (err) => toast(err.message, 'err'));
        break;
      default:
    }
  });

  function move(delta) {
    const rows = [...document.querySelectorAll('#list .row[data-id]')];
    if (!rows.length) return;
    const idx = rows.findIndex((r) => r.dataset.id === S.selected);
    const next = rows[Math.min(rows.length - 1, Math.max(0, idx < 0 ? 0 : idx + delta))];
    if (!next.classList.contains('remote')) select(next.dataset.id, false);
    next.focus({ preventScroll: true });
    next.scrollIntoView({ block: 'nearest' });
  }

  renderList();
  refresh(true);
  // Keep relative times ("vor 3 Min.") fresh even when nothing else changes.
  setInterval(() => {
    if (S.data && !document.hidden) renderAll();
  }, 60_000);
})();
