'use strict';

(() => {
  const COLORS = { alok: 'var(--alok)', ethelyn: 'var(--ethelyn)', jaansi: 'var(--jaansi)' };
  const colorFor = (id) => COLORS[id] || 'var(--accent)';

  // Pixel-art sprites. `head` is the head's centre and radius in the image's own pixels,
  // used to crop the face into the round runner token.
  const SPRITES = {
    alok: { src: 'characters/alok.png', w: 374, h: 536, head: { x: 204, y: 150, r: 82 } },
    jaansi: { src: 'characters/jaansi.png', w: 376, h: 508, head: { x: 210, y: 150, r: 82 } },
    ethelyn: { src: 'characters/ethelyn.png', w: 486, h: 594, head: { x: 294, y: 188, r: 92 } },
  };
  const TOKEN_R = 24;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const TRACK = { cx: 400, cy: 220, halfStraight: 190, laneRadii: [175, 140, 105], laneWidth: 35 };

  const $ = (id) => document.getElementById(id);
  const state = { advisors: [], approvers: [], user: null, standings: [], held: 0, checkins: [] };

  function el(tag, attrs, text) {
    const svg = tag.startsWith('svg:');
    const node = svg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function localToday() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function fmtDate(iso) {
    return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function listNames(names) {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  }
  function ordinal(n) {
    const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  async function api(url, options) {
    const res = await fetch(url, { credentials: 'same-origin', ...options });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  // ---------- Track ----------
  function lanePath(r) {
    const { cx, cy, halfStraight: L } = TRACK;
    return `M ${cx} ${cy + r} L ${cx + L} ${cy + r} A ${r} ${r} 0 0 0 ${cx + L} ${cy - r} ` +
           `L ${cx - L} ${cy - r} A ${r} ${r} 0 0 0 ${cx - L} ${cy + r} Z`;
  }

  function drawTrackBase(svg) {
    const { cx, cy, laneRadii, laneWidth } = TRACK;
    const outer = laneRadii[0] + laneWidth / 2;
    const inner = laneRadii[laneRadii.length - 1] - laneWidth / 2;
    svg.append(el('svg:path', { d: lanePath(outer), fill: 'var(--track)' }));
    for (let i = 1; i < laneRadii.length; i++) {
      svg.append(el('svg:path', {
        d: lanePath(laneRadii[i] + laneWidth / 2), fill: 'none', stroke: 'var(--track-line)',
        'stroke-width': 2, 'stroke-dasharray': '12 9', opacity: 0.7,
      }));
    }
    svg.append(el('svg:path', { d: lanePath(inner), fill: 'var(--infield)', stroke: 'var(--track-line)', 'stroke-width': 3 }));
    svg.append(el('svg:path', { d: lanePath(outer), fill: 'none', stroke: 'var(--track-line)', 'stroke-width': 3 }));

    const n = 8, size = (outer - inner) / n;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < 2; col++) {
        svg.append(el('svg:rect', {
          x: cx - size + col * size, y: cy + inner + row * size, width: size, height: size,
          fill: (row + col) % 2 ? '#111111' : '#ffffff',
        }));
      }
    }
    svg.append(el('svg:text', {
      x: cx, y: cy - 4, 'text-anchor': 'middle', fill: 'var(--track-line)',
      'font-family': 'Saira Condensed, Arial Narrow, sans-serif', 'font-weight': 800,
      'font-style': 'italic', 'font-size': 44, opacity: 0.9,
    }, 'CUTWATER MILE'));
    svg.append(el('svg:text', {
      x: cx, y: cy + 28, 'text-anchor': 'middle', fill: 'var(--track-line)',
      'font-family': 'Barlow, system-ui, sans-serif', 'font-size': 16, opacity: 0.8,
    }, 'Most sessions attended leads'));

    TRACK.lanes = TRACK.laneRadii.map((r) => {
      const p = el('svg:path', { d: lanePath(r), fill: 'none', stroke: 'none' });
      svg.append(p);
      return p;
    });
    TRACK.runnersLayer = el('svg:g');
    svg.append(TRACK.runnersLayer);
  }

  function drawRunners() {
    const layer = TRACK.runnersLayer;
    // Lanes are fixed per advisor so nobody hops lanes as ranks change.
    state.advisors.forEach((a, lane) => {
      const s = state.standings.find((r) => r.id === a.id);
      if (!s || !TRACK.lanes[lane]) return;
      const path = TRACK.lanes[lane];
      const pt = path.getPointAtLength(s.position * path.getTotalLength());
      let g = layer.querySelector(`[data-id="${a.id}"]`);
      if (!g) {
        g = el('svg:g', { class: 'runner', 'data-id': a.id });
        g.append(el('svg:title'));
        g.append(el('svg:circle', { r: TOKEN_R, fill: colorFor(a.id) }));
        const sprite = SPRITES[a.id];
        if (sprite) {
          const k = TOKEN_R / sprite.head.r;
          const clip = el('svg:clipPath', { id: 'face-' + a.id });
          clip.append(el('svg:circle', { r: TOKEN_R - 2 }));
          g.append(clip);
          g.append(el('svg:image', {
            href: sprite.src, width: sprite.w * k, height: sprite.h * k,
            x: -sprite.head.x * k, y: -sprite.head.y * k, 'clip-path': `url(#face-${a.id})`,
          }));
          g.append(el('svg:circle', { class: 'ring', r: TOKEN_R - 1, fill: 'none', style: `stroke: ${colorFor(a.id)}` }));
        } else {
          g.append(el('svg:text', { class: 'initial', 'text-anchor': 'middle', dy: 9 }, a.name[0]));
        }
        g.append(el('svg:text', { class: 'milk', x: 24, y: -18 }, '🥛'));
        layer.append(g);
      }
      g.style.transform = `translate(${pt.x}px, ${pt.y}px)`;
      g.querySelector('title').textContent = `${a.name}: ${s.sessions} session${s.sessions === 1 ? '' : 's'}`;
      g.querySelector('.milk').style.display = s.milkMile ? '' : 'none';
    });
  }

  function drawBibs() {
    const box = $('bibs');
    box.replaceChildren();
    let place = 0, prev = null;
    state.standings.forEach((r, i) => {
      if (r.sessions !== prev) place = i + 1;
      prev = r.sessions;
      const bib = el('div', { class: 'bib' + (r.milkMile ? ' milk-flag' : ''), style: `--c: ${colorFor(r.id)}` });
      const top = el('div', { class: 'bib-top' });
      top.append(el('span', { class: 'bib-place' }, ordinal(place) + ' place'));
      top.append(el('span', { class: 'bib-name' }, r.name));
      const num = el('div', { class: 'bib-num' }, String(r.sessions));
      num.append(el('small', {}, state.held ? ` of ${state.held} sessions` : ' sessions'));
      const rate = r.rate === null ? '' : `${r.rate}% attendance`;
      let text = r.milkMile ? `🥛 On course for the milk mile${rate ? ' · ' + rate : ''}`
        : r.lastSession ? `${rate} · last seen ${fmtDate(r.lastSession)}` : 'No approved sessions yet';
      if (r.pending) text += ` · ${r.pending} awaiting approval`;
      bib.append(top, num, el('div', { class: 'bib-sub' }, text));
      if (SPRITES[r.id]) {
        bib.classList.add('has-sprite');
        bib.append(el('img', { class: 'bib-sprite', src: SPRITES[r.id].src, alt: '' }));
      }
      box.append(bib);
    });
    $('track-meta').textContent = state.held
      ? `${state.held} session${state.held === 1 ? '' : 's'} held so far · race ends in December`
      : 'Race ends in December';
  }

  // ---------- Feed & approval queue ----------
  function photo(c, zoomable) {
    const img = el('img', { src: c.photoUrl, alt: `${c.advisorName} with ${c.witness}`, loading: 'lazy' });
    img.addEventListener('error', () => img.replaceWith(el('div', { class: 'noimg', role: 'img', 'aria-label': 'Photo unavailable' })));
    if (zoomable) img.addEventListener('click', () => img.classList.toggle('zoom'));
    return img;
  }

  function twoTap(label, confirmLabel, className, action) {
    const btn = el('button', { type: 'button', class: className }, label);
    btn.addEventListener('click', async () => {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1';
        btn.textContent = confirmLabel;
        setTimeout(() => { btn.dataset.armed = ''; if (!btn.disabled) btn.textContent = label; }, 4000);
        return;
      }
      btn.disabled = true;
      try {
        await action();
      } catch (e) {
        btn.disabled = false;
        btn.dataset.armed = '';
        btn.textContent = e.status === 401 ? 'Log in again' : 'Didn’t work. Try again';
        if (e.status === 401) setUser(null);
      }
    });
    return btn;
  }

  const removeCheckin = async (c) => {
    await api(`/api/checkins/${c.id}`, { method: 'DELETE' });
    await refresh();
  };

  function drawFeed() {
    const feed = $('feed');
    feed.replaceChildren();
    const items = state.checkins;
    $('feed-meta').textContent = items.length ? `${items.length} check-in${items.length === 1 ? '' : 's'}` : '';
    if (!items.length) {
      feed.append(el('p', { class: 'empty' }, 'No check-ins yet. The first photo starts the race.'));
      return;
    }
    for (const c of items) {
      const fig = el('figure', c.approved ? {} : { class: 'is-pending' });
      fig.append(photo(c, false));
      const cap = el('figcaption');
      cap.append(el('span', { class: 'tag', style: `--c: ${colorFor(c.advisorId)}` }), el('strong', {}, c.advisorName),
        ` with ${c.witness}`, el('br'), fmtDate(c.sessionDate));
      fig.append(cap);
      if (!c.approved) fig.append(el('span', { class: 'badge' }, `Waiting for ${c.witness}`));
      if (isApprover() && c.approved) {
        const wrap = el('div');
        wrap.append(twoTap('Remove', 'Tap again to remove', 'remove', () => removeCheckin(c)));
        fig.append(wrap);
      }
      feed.append(fig);
    }
  }

  function drawQueue() {
    const panel = $('queue-panel');
    const pending = state.checkins.filter((c) => !c.approved).reverse();
    panel.hidden = !isApprover() || !pending.length;
    if (panel.hidden) return;
    $('queue-meta').textContent = `${pending.length} to review`;
    const box = $('queue');
    box.replaceChildren();
    for (const c of pending) {
      const item = el('div', { class: 'q-item' });
      item.append(photo(c, true));
      const body = el('div', { class: 'q-body' });
      const title = el('div', { class: 'q-title' });
      title.append(el('span', { class: 'tag', style: `--c: ${colorFor(c.advisorId)}` }), `${c.advisorName} with ${c.witness}`);
      const submitted = new Date(c.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      body.append(title, el('div', { class: 'meta' }, `Session ${fmtDate(c.sessionDate)} · submitted ${submitted}`));
      const actions = el('div', { class: 'q-actions' });
      const approve = el('button', { type: 'button' }, 'Approve');
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        try {
          await api(`/api/checkins/${c.id}/approve`, { method: 'POST' });
          await refresh();
        } catch (e) {
          approve.disabled = false;
          approve.textContent = e.status === 401 ? 'Log in again' : 'Didn’t work. Try again';
          if (e.status === 401) setUser(null);
        }
      });
      actions.append(approve, twoTap('Reject', 'Tap again to reject', 'reject', () => removeCheckin(c)));
      body.append(actions);
      item.append(body);
      box.append(item);
    }
  }

  async function refresh() {
    const [{ held, standings }, checkins] = await Promise.all([
      api('/api/standings'),
      api('/api/checkins'),
    ]);
    state.held = held;
    state.standings = standings;
    state.checkins = checkins;
    drawRunners();
    drawBibs();
    drawQueue();
    drawFeed();
  }

  // ---------- Check-in form ----------
  function setStatus(id, msg, kind) {
    const s = $(id);
    s.textContent = msg;
    s.className = 'status' + (kind ? ' ' + kind : '');
  }

  function buildCheckinForm() {
    const ac = $('advisor-chips');
    for (const a of state.advisors) {
      const label = el('label', { style: `--c: ${colorFor(a.id)}` });
      label.append(el('input', { type: 'checkbox', name: 'advisors', value: a.id, id: 'adv-' + a.id }),
        el('span', { class: 'dot' }), a.name);
      ac.append(label);
    }
    const wc = $('witness-chips');
    state.approvers.forEach((w, i) => {
      const label = el('label');
      const input = el('input', { type: 'radio', name: 'witness', value: w, id: 'wit-' + w.toLowerCase() });
      if (i === 0) input.checked = true;
      label.append(input, w);
      wc.append(label);
    });
    $('date').value = localToday();
    $('date').max = localToday();

    const resetDrop = () => $('drop-text').replaceChildren(el('strong', {}, 'Choose the photo'), el('br'), 'taken with Miguel or Frida');
    $('photo').addEventListener('change', () => {
      const f = $('photo').files[0];
      const prev = $('preview');
      if (prev.src.startsWith('blob:')) URL.revokeObjectURL(prev.src);
      prev.hidden = !f;
      if (f) {
        prev.src = URL.createObjectURL(f);
        $('drop-text').replaceChildren(el('strong', {}, f.name), el('br'), 'Tap to choose a different photo');
      } else {
        resetDrop();
      }
    });

    $('checkin').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const file = $('photo').files[0];
      const picked = [...form.querySelectorAll('input[name="advisors"]:checked')];
      const date = $('date').value;
      if (!file) return setStatus('status', 'Choose the photo first.', 'bad');
      if (!picked.length) return setStatus('status', 'Tick at least one advisor who is in the photo.', 'bad');
      if (!date) return setStatus('status', 'Pick the session date.', 'bad');

      const body = new FormData();
      body.append('photo', file);
      picked.forEach((i) => body.append('advisors', i.value));
      const witness = form.querySelector('input[name="witness"]:checked').value;
      body.append('witness', witness);
      body.append('sessionDate', date);

      const btn = $('submit');
      btn.disabled = true;
      setStatus('status', 'Uploading photo…');
      try {
        await api('/api/checkins', { method: 'POST', body });
        const names = picked.map((i) => state.advisors.find((a) => a.id === i.value).name);
        setStatus('status', `Sent to ${witness} for approval. ${listNames(names)} will move up once it’s approved.`, 'ok');
        $('photo').value = '';
        $('preview').hidden = true;
        resetDrop();
        picked.forEach((i) => { i.checked = false; });
        tickSelf();
        await refresh();
      } catch (err) {
        setStatus('status', err.message, 'bad');
        if (err.status === 401) setUser(null);
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ---------- Login ----------
  const isApprover = () => Boolean(state.user?.approver);

  function tickSelf() {
    document.querySelectorAll('input[name="advisors"]').forEach((i) => { i.checked = false; });
    const me = state.user && state.advisors.find((a) => a.name === state.user.name);
    if (me) $('adv-' + me.id).checked = true;
  }

  function setUser(user) {
    state.user = user;
    $('login').hidden = Boolean(user);
    $('account').hidden = !user;
    $('checkin').hidden = !user;
    if (user) {
      $('account-text').textContent = user.approver
        ? `Logged in as ${user.name}. Photos waiting for your approval appear at the top of the page.`
        : `Logged in as ${user.name}.`;
      tickSelf();
    }
    drawQueue();
    drawFeed();
  }

  function buildLogin(people) {
    const chips = $('people-chips');
    people.forEach((name) => {
      const label = el('label');
      label.append(el('input', { type: 'radio', name: 'person', value: name, id: 'person-' + name.toLowerCase() }), name);
      chips.append(label);
    });
    if (!people.length) {
      $('login').replaceChildren(el('p', { class: 'notice' }, 'Logins aren’t set up yet. The server needs a PASSWORDS setting.'));
      return;
    }
    $('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = e.currentTarget.querySelector('input[name="person"]:checked')?.value;
      if (!name) return setStatus('login-status', 'Pick your name.', 'bad');
      const btn = $('login-submit');
      btn.disabled = true;
      try {
        const { user } = await api('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, password: $('password').value }),
        });
        $('password').value = '';
        setStatus('login-status', '');
        setUser(user);
        if (user.approver && !$('queue-panel').hidden) {
          $('queue-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      } catch (err) {
        setStatus('login-status', err.message, 'bad');
      } finally {
        btn.disabled = false;
      }
    });
    $('logout').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' }).catch(() => {});
      setStatus('status', '');
      setUser(null);
    });
  }

  // ---------- Music ----------
  // Browsers block sound until someone taps, so music starts from the button.
  function setupMusic() {
    const audio = $('theme');
    const btn = $('music');
    const sync = () => {
      const on = !audio.paused;
      btn.setAttribute('aria-pressed', String(on));
      btn.textContent = on ? '♫ Music on' : '♪ Play music';
    };
    btn.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => {}); else audio.pause();
    });
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.volume = 0.4;
    sync();
  }

  // ---------- Boot ----------
  (async () => {
    drawTrackBase($('track'));
    setupMusic();
    try {
      const config = await api('/api/config');
      state.advisors = config.advisors;
      state.approvers = config.approvers;
      buildCheckinForm();
      buildLogin(config.people);
      await refresh();
      setUser(config.user);
    } catch (err) {
      $('track-meta').textContent = `Couldn’t load the race: ${err.message}`;
    }
  })();
})();
