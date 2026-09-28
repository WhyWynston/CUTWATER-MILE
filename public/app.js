'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
const COLORS = { ethelyn: 'var(--ethelyn)', alok: 'var(--alok)', jaansi: 'var(--jaansi)' };
const colorFor = (id) => COLORS[id] || 'var(--accent)';

// Track geometry: a stadium (two straights joined by semicircles), 3 lanes.
const TRACK = { cx: 400, cy: 220, halfStraight: 190, laneRadii: [175, 140, 105], laneWidth: 35 };

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, text) {
  const node = tag.startsWith('svg:')
    ? document.createElementNS(SVG_NS, tag.slice(4))
    : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Lane path starting at the finish line (bottom centre), running counter-clockwise. */
function lanePath(r) {
  const { cx, cy, halfStraight: L } = TRACK;
  return [
    `M ${cx} ${cy + r}`,
    `L ${cx + L} ${cy + r}`,
    `A ${r} ${r} 0 0 0 ${cx + L} ${cy - r}`,
    `L ${cx - L} ${cy - r}`,
    `A ${r} ${r} 0 0 0 ${cx - L} ${cy + r}`,
    'Z',
  ].join(' ');
}

function drawTrack(svg, standings) {
  svg.replaceChildren();
  const { cx, cy, laneRadii, laneWidth } = TRACK;
  const outer = laneRadii[0] + laneWidth / 2;
  const inner = laneRadii[laneRadii.length - 1] - laneWidth / 2;

  // Surface, lane lines, infield.
  svg.append(el('svg:path', { d: lanePath(outer), fill: 'var(--track)' }));
  laneRadii.forEach((r, i) => {
    if (i > 0) {
      svg.append(el('svg:path', {
        d: lanePath(r + laneWidth / 2), fill: 'none', stroke: 'var(--line)',
        'stroke-width': 2, 'stroke-dasharray': '10 8', opacity: 0.6,
      }));
    }
  });
  svg.append(el('svg:path', { d: lanePath(inner), fill: 'var(--infield)', stroke: 'var(--line)', 'stroke-width': 3 }));
  svg.append(el('svg:path', { d: lanePath(outer), fill: 'none', stroke: 'var(--line)', 'stroke-width': 3 }));

  // Checkered start/finish line.
  const squares = 8;
  const size = (outer - inner) / squares;
  for (let row = 0; row < squares; row++) {
    for (let col = 0; col < 2; col++) {
      svg.append(el('svg:rect', {
        x: cx - size + col * size, y: cy + inner + row * size, width: size, height: size,
        fill: (row + col) % 2 ? '#111' : '#fff',
      }));
    }
  }

  const title = el('svg:text', {
    x: cx, y: cy + 8, 'text-anchor': 'middle', fill: 'var(--line)',
    'font-size': 30, 'font-weight': 800, 'font-style': 'italic', opacity: 0.85,
  }, 'CUTWATER MILE');
  svg.append(title);
  svg.append(el('svg:text', {
    x: cx, y: cy + 36, 'text-anchor': 'middle', fill: 'var(--line)', 'font-size': 14, opacity: 0.7,
  }, `🏁 finish = ${state.trackLength} sessions`));

  // Runners: lane assignment is fixed by advisor so nobody hops lanes as ranks change.
  const laneOrder = [...standings].sort((a, b) => a.id.localeCompare(b.id));
  laneOrder.forEach((s, i) => {
    const lane = el('svg:path', { d: lanePath(laneRadii[i]) });
    svg.append(lane);
    const total = lane.getTotalLength();
    // Stay just shy of the line at 100% so finishers sit at the flag, not back at the start.
    const p = lane.getPointAtLength(Math.min(s.progress, 0.999) * total);
    lane.remove();

    const g = el('svg:g', { class: 'runner', transform: `translate(${p.x} ${p.y})` });
    g.append(el('svg:title', {}, `${s.name}: ${s.sessions} session${s.sessions === 1 ? '' : 's'}`));
    g.append(el('svg:circle', { r: 22, fill: colorFor(s.id) }));
    g.append(el('svg:text', { 'text-anchor': 'middle', dy: 8, fill: '#111' }, s.name[0]));
    if (s.milkMile) {
      g.append(el('svg:text', { x: 22, y: -16, 'font-size': 28 }, '🥛'));
    }
    svg.append(g);
  });
}

function drawLeaderboard(list, standings) {
  list.replaceChildren();
  let rank = 0;
  let prev = null;
  standings.forEach((s, i) => {
    if (s.sessions !== prev) rank = i + 1;
    prev = s.sessions;
    const li = el('li', { style: `--c: ${colorFor(s.id)}` });
    if (s.milkMile) li.classList.add('milk');
    li.append(el('span', { class: 'pos' }, String(rank)));
    const name = el('span', { class: 'name' }, s.name + (s.milkMile ? ' 🥛' : ''));
    name.append(el('span', { class: 'sub' },
      s.milkMile ? 'On the hook for the milk mile'
        : s.lastSession ? `Last seen ${formatDate(s.lastSession)}` : 'Not on the board yet'));
    li.append(name);
    li.append(el('span', { class: 'count' }, `${s.sessions}/${state.trackLength}`));
    list.append(li);
  });
}

function drawFeed(container, checkins) {
  container.replaceChildren();
  if (!checkins.length) {
    container.append(el('p', { class: 'muted' }, 'No check-ins yet. Be the first!'));
    return;
  }
  for (const c of checkins) {
    const fig = el('figure');
    const img = el('img', { src: c.photoUrl, alt: `${c.advisorName} with ${c.witness}`, loading: 'lazy' });
    const cap = el('figcaption');
    cap.append(el('strong', {}, c.advisorName), ` with ${c.witness} · ${formatDate(c.sessionDate)}`);
    fig.append(img, cap);
    container.append(fig);
  }
}

function formatDate(iso) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function localToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

async function api(url, options) {
  const res = await fetch(url, options);
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

const state = { trackLength: 20 };

async function refresh() {
  const [{ trackLength, standings }, checkins] = await Promise.all([
    api('/api/standings'),
    api('/api/checkins'),
  ]);
  state.trackLength = trackLength;
  $('#track-meta').textContent =
    `Every work session photo moves you one step. First to ${trackLength} crosses the line.`;
  drawTrack($('#track'), standings);
  drawLeaderboard($('#leaderboard'), standings);
  drawFeed($('#feed'), checkins);
}

function buildForm({ advisors, witnesses }) {
  const advisorBox = $('#advisor-options');
  for (const a of advisors) {
    const label = el('label');
    label.append(el('input', { type: 'checkbox', name: 'advisors', value: a.id }), a.name);
    advisorBox.append(label);
  }
  const witnessBox = $('#witness-options');
  witnesses.forEach((w, i) => {
    const label = el('label');
    const input = el('input', { type: 'radio', name: 'witness', value: w, required: '' });
    if (i === 0) input.checked = true;
    label.append(input, w);
    witnessBox.append(label);
  });

  const form = $('#checkin-form');
  const status = $('#form-status');
  const preview = $('#preview');
  form.sessionDate.value = localToday();
  form.sessionDate.max = localToday();

  form.photo.addEventListener('change', () => {
    const file = form.photo.files[0];
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.hidden = !file;
    if (file) preview.src = URL.createObjectURL(file);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.className = 'status';
    if (!form.querySelector('input[name="advisors"]:checked')) {
      status.textContent = 'Pick at least one advisor.';
      status.classList.add('error');
      return;
    }
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Uploading…';
    try {
      const { ids } = await api('/api/checkins', { method: 'POST', body: new FormData(form) });
      status.textContent = `Checked in! ${ids.length} runner${ids.length === 1 ? '' : 's'} moved up. 🏃`;
      status.classList.add('ok');
      form.photo.value = '';
      preview.hidden = true;
      form.querySelectorAll('input[name="advisors"]').forEach((i) => { i.checked = false; });
      await refresh();
    } catch (err) {
      status.textContent = err.message;
      status.classList.add('error');
    } finally {
      button.disabled = false;
    }
  });
}

(async function init() {
  try {
    buildForm(await api('/api/config'));
    await refresh();
  } catch (err) {
    $('#track-meta').textContent = `Couldn't load the race: ${err.message}`;
  }
})();
