/* Tulpa Chat — a local, browser-only stand-in for proxied Discord chat.
   No build step, no framework. State is one plain object saved to
   localStorage; everything on screen is re-rendered from it. */
'use strict';
(() => {

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const THEMES = {
  'discord-dark':  { label: 'Discord dark',  layout: 'rows' },
  'discord-light': { label: 'Discord light', layout: 'rows' },
  'starship':      { label: 'Starship',      layout: 'rows' },
  'whisperer':     { label: 'Whisperer',     layout: 'rows' },
  'bubbles-light': { label: 'Bubbles light', layout: 'bubbles' },
  'bubbles-dark':  { label: 'Bubbles dark',  layout: 'bubbles' },
  'parchment':     { label: 'Parchment (prose)', layout: 'prose' },
};
const CAPTURE_WIDTHS = [360, 480, 640, 800];
const WRITER = '__writer';
const PALETTE = ['#f47b67', '#f8a532', '#e9c46a', '#48b784', '#45b5c4', '#5e9cf0', '#8f7cf0', '#d47bd8', '#f06595', '#9aa5b1'];
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';

// ---------------------------------------------------------------------------
// Storage. Phase 2 (accounts / cloud sync) slots in as another object with
// the same load()/save() shape; nothing else needs to know which is in use.
// ---------------------------------------------------------------------------
const LocalStore = {
  key: 'tulpachat:v1',
  load() {
    try { return JSON.parse(localStorage.getItem(this.key)); } catch { return null; }
  },
  save(data) {
    try { localStorage.setItem(this.key, JSON.stringify(data)); return true; } catch { return false; }
  },
  clear() {
    try { localStorage.removeItem(this.key); } catch { /* nothing to clear */ }
  },
};
const store = LocalStore;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/-/g, '').slice(0, 16);
}
function newStory(title = 'Untitled story') {
  const now = Date.now();
  return { id: uid(), title, created: now, updated: now, messages: [] };
}
function defaultSettings() {
  return {
    theme: 'discord-dark', writerName: 'Writer', writerAvatar: '', writerSide: 'right',
    showTimestamps: true, showTags: true, colorNames: true, groupMessages: true,
    autoLatch: false, imageProxy: true, captureWidth: 480,
  };
}
function normaliseState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const out = {
    v: 1,
    cast: Array.isArray(s.cast) ? s.cast : [],
    groups: Array.isArray(s.groups) ? s.groups : [],
    stories: Array.isArray(s.stories) && s.stories.length ? s.stories : [newStory()],
    activeStoryId: s.activeStoryId,
    latch: s.latch || null,
    settings: { ...defaultSettings(), ...(s.settings || {}) },
  };
  if (!THEMES[out.settings.theme]) out.settings.theme = 'discord-dark';
  if (!out.stories.some(st => st.id === out.activeStoryId)) out.activeStoryId = out.stories[0].id;
  for (const t of out.cast) t.brackets = Array.isArray(t.brackets) ? t.brackets : [];
  for (const st of out.stories) st.messages = Array.isArray(st.messages) ? st.messages : [];
  return out;
}

let state = normaliseState(store.load());
const ui = {
  editingId: null,      // message being edited inline
  insertAfterId: null,  // new messages go after this one instead of the end
  activeMsgId: null,    // touch devices: which message shows its tools
  selection: new Set(), // capture mode picks
  capture: false,
};

let saveTimer = 0;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 250);
}
function flush() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  if (!store.save(state)) toast('Could not save — browser storage is full or blocked. Download a backup from Settings.');
}
window.addEventListener('pagehide', () => { if (saveTimer) flush(); });

const story = () => state.stories.find(s => s.id === state.activeStoryId);
function touchStory() { story().updated = Date.now(); persist(); }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false && kid !== '') el.append(kid);
  return el;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function safeColor(c) { return /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : ''; }
function hashColor(str) {
  let x = 0;
  for (const ch of String(str)) x = (x * 31 + ch.codePointAt(0)) >>> 0;
  return PALETTE[x % PALETTE.length];
}
function initialsAvatar(name, color) {
  const letters = String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => [...w][0] || '').join('').toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${safeColor(color) || '#5865f2'}"/>` +
    `<text x="40" y="40" dy=".35em" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="34" font-weight="600" fill="#fff">${esc(letters)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
function slug(s) { return String(s || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'; }
function fmtTime(ts) {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `Today at ${time}` : `${d.toLocaleDateString()} ${time}`;
}
function download(blobOrText, filename, mime = 'text/plain') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type: mime + ';charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
// Square-crop and shrink an uploaded image so avatars don't eat localStorage.
function fileToAvatar(file, size = 128) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = size;
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/webp', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Not an image')); };
    img.src = url;
  });
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = h('script', { src, crossorigin: 'anonymous' });
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load ' + src));
    document.head.append(s);
  });
}

let toastTimer = 0;
function toast(text, action) {
  const el = $('toast');
  el.replaceChildren(h('span', { text }));
  if (action) el.append(h('button', { type: 'button', text: action.label, onclick: () => { el.hidden = true; action.run(); } }));
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 3500);
}

// ---------------------------------------------------------------------------
// Discord-flavoured markdown. Input is escaped first, so only the tags
// emitted here can reach the DOM.
// ---------------------------------------------------------------------------
function renderMarkdown(src) {
  const held = [];
  const hold = html => `\u0000${held.push(html) - 1}\u0000`;
  let s = esc(String(src).replace(/\u0000/g, ''));

  s = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_, code) => hold(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`));
  s = s.replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${code}</code>`));
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,:;!?)\]'"]/g, url => hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));

  // Line-level blocks. Block elements swallow their own line break.
  const lines = s.split('\n');
  s = '';
  lines.forEach((line, i) => {
    let m, block = true;
    if ((m = line.match(/^&gt; (.*)$/))) line = `<span class="quote">${m[1]}</span>`;
    else if ((m = line.match(/^(#{1,3}) (.+)$/))) line = `<span class="h h${m[1].length}">${m[2]}</span>`;
    else if ((m = line.match(/^-# (.+)$/))) line = `<span class="sub">${m[1]}</span>`;
    else block = false;
    s += line + (i < lines.length - 1 && !block ? '\n' : '');
  });

  s = s.replace(/\|\|([\s\S]+?)\|\|/g, '<span class="spoiler">$1</span>')
    .replace(/\*\*\*(?!\s)([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(?!\s)([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?!\s)([\s\S]+?)__/g, '<u>$1</u>')
    .replace(/\*(?![\s*])([\s\S]+?)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?![\s_])([\s\S]+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?!\s)([\s\S]+?)~~/g, '<s>$1</s>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => held[+i]);
}

// ---------------------------------------------------------------------------
// Cast & speakers
// ---------------------------------------------------------------------------
const tupperById = id => (id && id !== WRITER ? state.cast.find(t => t.id === id) : null) || null;

function tagFor(t) {
  if (!state.settings.showTags) return '';
  if (t.tag) return t.tag;
  const g = state.groups.find(g => g.id === t.groupId);
  return (g && g.tag) || '';
}
function tupperInfo(t) {
  const name = (t.nick || t.name || 'Unnamed') + (tagFor(t) ? ' ' + tagFor(t) : '');
  const color = safeColor(t.color) || hashColor(t.name);
  return { key: t.id, name, short: t.nick || t.name, avatar: t.avatarUpload || t.avatar || '', color, side: t.side === 'right' ? 'right' : 'left', isWriter: false };
}
function writerInfo() {
  const s = state.settings;
  return { key: WRITER, name: s.writerName || 'Writer', avatar: s.writerAvatar || '', color: '#80848e', side: s.writerSide === 'left' ? 'left' : 'right', isWriter: true };
}
function speakerInfo(msg) {
  if (!msg.speaker) return writerInfo();
  const t = tupperById(msg.speaker);
  if (t) return tupperInfo(t);
  // Speaker was deleted: keep their words under the name we saved with them.
  const name = msg.speakerName || 'Unknown';
  return { key: 'gone:' + msg.speaker, name, avatar: '', color: hashColor(name), side: 'left', isWriter: false };
}
const byName = (a, b) => (a.nick || a.name).localeCompare(b.nick || b.name, undefined, { sensitivity: 'base' });

function bracketsLabel(t) {
  return t.brackets.length ? t.brackets.map(([p, s]) => `${p}text${s}`).join('   ') : 'no brackets';
}

// Most specific bracket pair wins, so "kat:" beats "k:" regardless of order.
function matchProxy(text) {
  let best = null;
  for (const t of state.cast) {
    for (const [pre, suf] of t.brackets) {
      if (!pre && !suf) continue;
      if (text.length < pre.length + suf.length) continue;
      if (!text.startsWith(pre) || !text.endsWith(suf)) continue;
      const score = pre.length + suf.length;
      if (!best || score > best.score) best = { tupper: t, text: text.slice(pre.length, text.length - suf.length).trim(), score };
    }
  }
  return best;
}

// Work out who a composer message belongs to, Tupperbox-style.
function resolve(raw) {
  const text = raw.trim();
  if (text.startsWith('\\\\')) return { tupper: null, text: text.slice(2).trim(), via: 'unlatch' };
  if (text.startsWith('\\')) return { tupper: null, text: text.slice(1).trim(), via: 'escape' };
  const m = matchProxy(text);
  if (m) return { tupper: m.tupper, text: m.text, via: 'brackets' };
  const latched = tupperById(state.latch);
  if (latched) return { tupper: latched, text, via: 'latch' };
  return { tupper: null, text, via: 'none' };
}

// ---------------------------------------------------------------------------
// Importing: Tupperbox / PluralKit exports, Tulpa Chat story files & backups
// ---------------------------------------------------------------------------
function bracketPairs(arr) {
  if (!Array.isArray(arr)) return [];
  if (arr.every(Array.isArray)) return arr.map(([p = '', s = '']) => [String(p), String(s)]).filter(([p, s]) => p || s);
  const out = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const p = String(arr[i] || ''), s = String(arr[i + 1] || '');
    if (p || s) out.push([p, s]);
  }
  return out;
}

function parseCastExport(data) {
  if (Array.isArray(data.tuppers)) {
    return {
      kind: 'Tupperbox',
      groups: (data.groups || []).map(g => ({ id: 'tb:' + g.id, name: String(g.name || ''), tag: String(g.tag || '') })),
      cast: data.tuppers.map(t => ({
        src: 'tb:' + t.id,
        name: String(t.name || 'Unnamed'),
        nick: String(t.nick || ''),
        tag: String(t.tag || ''),
        groupId: t.group_id != null ? 'tb:' + t.group_id : null,
        brackets: bracketPairs(t.brackets),
        avatar: String(t.avatar_url || ''),
        description: String(t.description || ''),
      })),
    };
  }
  if (Array.isArray(data.members)) {
    return {
      kind: 'PluralKit',
      groups: [],
      cast: data.members.map(m => ({
        src: 'pk:' + (m.uuid || m.id),
        name: String(m.name || 'Unnamed'),
        nick: String(m.display_name || ''),
        tag: String(data.tag || ''),
        groupId: null,
        brackets: (m.proxy_tags || []).map(p => [String(p.prefix || ''), String(p.suffix || '')]).filter(([p, s]) => p || s),
        avatar: String(m.avatar_url || ''),
        color: m.color ? '#' + String(m.color).replace(/^#/, '') : '',
        description: String(m.description || ''),
      })),
    };
  }
  return null;
}

// Re-importing updates people in place and keeps local tweaks (uploaded
// avatar, colour, bubble side) unless the export brings its own colour.
function mergeCast(parsed) {
  let added = 0, updated = 0;
  for (const g of parsed.groups) {
    const existing = state.groups.find(x => x.id === g.id);
    if (existing) Object.assign(existing, g); else state.groups.push(g);
  }
  for (const c of parsed.cast) {
    const t = state.cast.find(x => c.src && x.src === c.src) || state.cast.find(x => !x.src && x.name === c.name);
    if (t) {
      const keepColor = t.color;
      Object.assign(t, c);
      if (!c.color) t.color = keepColor || '';
      updated++;
    } else {
      state.cast.push({ id: uid(), color: '', side: 'left', avatarUpload: '', ...c });
      added++;
    }
  }
  return { added, updated };
}

async function importFile(file) {
  let data;
  try { data = JSON.parse(await readFileText(file)); } catch {
    toast(`${file.name} isn't valid JSON.`);
    return;
  }
  if (data && data.app === 'tulpachat' && data.kind === 'backup') {
    if (!confirm('Restore this backup? It replaces everything currently in this browser.')) return;
    state = normaliseState(data.state);
    resetUi();
    flush();
    renderAll();
    toast('Backup restored.');
    return;
  }
  if (data && data.app === 'tulpachat' && data.kind === 'story') {
    const { added } = mergeCast({ groups: data.groups || [], cast: (data.cast || []).map(c => ({ ...c, brackets: bracketPairs(c.brackets) })) });
    // Speaker ids inside the story refer to the sender's cast; remap by source/name.
    const idMap = new Map();
    for (const c of data.cast || []) {
      const t = state.cast.find(x => (c.src && x.src === c.src) || x.name === c.name);
      if (t) idMap.set(c.id, t.id);
    }
    const st = newStory(String(data.story.title || 'Imported story'));
    st.messages = (data.story.messages || []).map(m => ({ ...m, id: uid(), speaker: m.speaker ? idMap.get(m.speaker) || m.speaker : null }));
    state.stories.unshift(st);
    state.activeStoryId = st.id;
    resetUi();
    flush();
    renderAll();
    toast(`Imported “${st.title}” (${st.messages.length} messages${added ? `, ${added} new cast` : ''}).`);
    return;
  }
  const parsed = data && parseCastExport(data);
  if (!parsed) {
    toast(`Couldn't recognise ${file.name} — expected a Tupperbox or PluralKit export.`);
    return;
  }
  const { added, updated } = mergeCast(parsed);
  flush();
  renderCast();
  renderStream({ scroll: 'keep' });
  toast(`${parsed.kind}: ${added} added, ${updated} updated.`);
}

// ---------------------------------------------------------------------------
// Rendering: messages
// ---------------------------------------------------------------------------
function avatarEl(info, cls = 'avatar') {
  const fallback = initialsAvatar(info.short || info.name, info.color);
  const img = h('img', { class: cls, alt: '', referrerpolicy: 'no-referrer', dataset: { fallback } });
  img.onerror = () => { img.onerror = null; img.src = fallback; };
  img.src = info.avatar || fallback;
  return img;
}

function buildGroup(info, firstMsg) {
  const s = state.settings;
  const meta = h('div', { class: 'meta' },
    h('span', { class: 'name', text: info.name }),
    s.showTimestamps && h('time', { text: fmtTime(firstMsg.ts) }));
  const body = h('div', { class: 'body' }, meta);
  const cls = ['group', info.side === 'right' && 'right', info.isWriter && 'writer'].filter(Boolean).join(' ');
  const el = h('div', { class: cls, style: info.isWriter ? null : `--speaker:${info.color}` }, avatarEl(info), body);
  return { el, body };
}

function buildMsg(m, interactive) {
  const el = h('div', { class: 'msg', dataset: { id: m.id } });
  if (interactive && ui.editingId === m.id) {
    el.append(buildEditor(m));
    return el;
  }
  el.append(h('div', { class: 'content', html: renderMarkdown(m.text) }));
  if (interactive) {
    const tool = (icon, label, run, extra = '') =>
      h('button', { type: 'button', class: 'icon-btn ' + extra, title: label, 'aria-label': label, text: icon, onclick: e => { e.stopPropagation(); run(); } });
    el.append(h('div', { class: 'tools' },
      tool('✎', 'Edit', () => startEdit(m.id)),
      tool('↑', 'Move up', () => moveMsg(m.id, -1)),
      tool('↓', 'Move down', () => moveMsg(m.id, 1)),
      tool('↳', 'Write after this', () => setInsertAfter(m.id)),
      tool('🗑', 'Delete', () => deleteMsg(m.id), 'danger')));
    if (ui.selection.has(m.id)) el.classList.add('selected');
    if (ui.activeMsgId === m.id) el.classList.add('active');
    if (ui.insertAfterId === m.id) el.classList.add('insert-point');
  }
  return el;
}

function renderMessages(container, msgs, { interactive = false } = {}) {
  container.replaceChildren();
  container.classList.toggle('interactive', interactive);
  let group = null, prevKey = null;
  for (const m of msgs) {
    const info = speakerInfo(m);
    // Editing breaks a group so the speaker picker sits under a visible name.
    if (!group || info.key !== prevKey || !state.settings.groupMessages || (interactive && ui.editingId === m.id)) {
      group = buildGroup(info, m);
      container.append(group.el);
    }
    group.body.append(buildMsg(m, interactive));
    prevKey = (interactive && ui.editingId === m.id) ? null : info.key;
  }
}

function emptyState() {
  const hasCast = state.cast.length > 0;
  return h('div', { class: 'empty' },
    h('p', { html: '<b>Blank page.</b>' }),
    hasCast
      ? h('p', { html: 'Type with someone’s brackets — like <code>k:hello</code> — or click a name in the cast to latch them.' })
      : h('p', { html: 'Import your cast from the sidebar: Tupperbox <code>tul!export</code> or PluralKit <code>pk;export</code> both work. Or add someone by hand.' }),
    h('p', { class: 'muted small', text: 'Unbracketed text is posted as you. Everything stays in this browser.' }));
}

function renderStream({ scroll = 'keep', toId = null } = {}) {
  const stream = $('stream'), inner = $('streamInner');
  const msgs = story().messages;
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 40;
  const prevTop = stream.scrollTop;
  renderMessages(inner, msgs, { interactive: true });
  if (!msgs.length) inner.append(emptyState());
  if (toId) {
    const el = inner.querySelector(`.msg[data-id="${toId}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  } else if (scroll === 'bottom' || (scroll === 'keep' && atBottom)) {
    stream.scrollTop = stream.scrollHeight;
  } else {
    stream.scrollTop = prevTop;
  }
  updateCaptureInfo();
}

// ---------------------------------------------------------------------------
// Rendering: sidebar, header, speaker bar
// ---------------------------------------------------------------------------
function renderCast() {
  const list = $('castList');
  const q = $('castFilter').value.trim().toLowerCase();
  $('castCount').textContent = state.cast.length;
  list.replaceChildren();

  const writer = writerInfo();
  list.append(castItem({ info: writer, sub: 'unbracketed text', current: !state.latch, onPick: () => setLatch(null), onEdit: openSettings }));

  const people = [...state.cast].sort(byName)
    .filter(t => !q || `${t.name} ${t.nick || ''} ${bracketsLabel(t)}`.toLowerCase().includes(q));
  for (const t of people) {
    list.append(castItem({
      info: tupperInfo(t), sub: bracketsLabel(t), mono: true, current: state.latch === t.id,
      onPick: () => setLatch(state.latch === t.id ? null : t.id), onEdit: () => openTupperDialog(t.id),
    }));
  }
  if (!state.cast.length) list.append(h('p', { class: 'muted small', text: 'No cast yet. Import a Tupperbox or PluralKit export, or add someone by hand.' }));
  else if (!people.length) list.append(h('p', { class: 'muted small', text: 'Nobody matches that filter.' }));
}

function castItem({ info, sub, mono, current, onPick, onEdit }) {
  return h('div', {
    class: 'item' + (current ? ' current' : ''), role: 'button', tabindex: '0',
    title: current ? 'Speaking as ' + info.name : 'Click to speak as ' + info.name,
    onclick: onPick,
    onkeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } },
  },
  avatarEl(info, 'avatar sm'),
  h('div', { class: 'item-text' },
    h('div', { class: 'item-title', text: info.name }),
    h('div', { class: 'item-sub' + (mono ? ' mono' : ''), text: sub })),
  h('button', { type: 'button', class: 'icon-btn', text: '✎', title: 'Edit', 'aria-label': 'Edit ' + info.name, onclick: e => { e.stopPropagation(); onEdit(); } }));
}

function renderStories() {
  const list = $('storyList');
  list.replaceChildren();
  const sorted = [...state.stories].sort((a, b) => b.updated - a.updated);
  for (const st of sorted) {
    list.append(h('div', {
      class: 'item' + (st.id === state.activeStoryId ? ' current' : ''), role: 'button', tabindex: '0',
      onclick: () => openStory(st.id),
      onkeydown: e => { if (e.key === 'Enter') openStory(st.id); },
    },
    h('div', { class: 'item-text' },
      h('div', { class: 'item-title', text: st.title || 'Untitled story' }),
      h('div', { class: 'item-sub', text: `${st.messages.length} message${st.messages.length === 1 ? '' : 's'} · ${new Date(st.updated).toLocaleDateString()}` })),
    h('button', { type: 'button', class: 'icon-btn', text: '🗑', title: 'Delete story', 'aria-label': 'Delete ' + st.title, onclick: e => { e.stopPropagation(); deleteStory(st.id); } })));
  }
}

function renderHeader() {
  const title = $('storyTitle');
  if (document.activeElement !== title) title.value = story().title;
  document.title = `${story().title || 'Untitled story'} · Tulpa Chat`;
}

function applyTheme() {
  const s = state.settings, root = document.documentElement;
  root.dataset.theme = s.theme;
  root.dataset.layout = THEMES[s.theme].layout;
  root.classList.toggle('color-names', !!s.colorNames);
  root.style.setProperty('--capture-width', s.captureWidth + 'px');
  $('themeSelect').value = s.theme;
}

function updateSpeakerBar() {
  const bar = $('speakerBar');
  const chips = [];
  const xBtn = (label, run) => h('button', { type: 'button', class: 'icon-btn', text: '✕', title: label, 'aria-label': label, onclick: run });

  if (ui.insertAfterId) {
    chips.push(h('span', { class: 'chip plain' }, '↳ Writing after the marked message ', xBtn('Back to the end', () => setInsertAfter(null))));
  }
  const raw = $('input').value;
  const r = raw.trim() ? resolve(raw) : { tupper: tupperById(state.latch), via: 'latch' };
  if (r.tupper) {
    const info = tupperInfo(r.tupper);
    const lead = r.via === 'latch' ? 'Latched: ' : 'As ';
    chips.push(h('span', { class: 'chip' }, avatarEl(info, 'avatar xs'), lead, h('b', { text: info.name }),
      r.via === 'latch' ? xBtn('Unlatch', () => setLatch(null)) : null));
  } else if (raw.trim()) {
    chips.push(h('span', { class: 'chip' }, avatarEl(writerInfo(), 'avatar xs'), 'As ', h('b', { text: writerInfo().name })));
  }
  bar.replaceChildren(...chips);
  bar.hidden = !chips.length;
}

function renderAll() {
  applyTheme();
  renderHeader();
  renderCast();
  renderStories();
  renderStream({ scroll: 'bottom' });
  updateSpeakerBar();
}

// ---------------------------------------------------------------------------
// Actions: messages
// ---------------------------------------------------------------------------
function send() {
  const input = $('input');
  if (!input.value.trim()) return;
  const r = resolve(input.value);
  if (r.via === 'unlatch') state.latch = null;
  if (r.tupper && r.via === 'brackets' && state.settings.autoLatch) state.latch = r.tupper.id;
  if (r.text) {
    const msg = { id: uid(), speaker: r.tupper ? r.tupper.id : null, speakerName: r.tupper ? r.tupper.name : null, text: r.text, ts: Date.now() };
    const msgs = story().messages;
    const at = ui.insertAfterId ? msgs.findIndex(m => m.id === ui.insertAfterId) : -1;
    if (at >= 0) {
      msgs.splice(at + 1, 0, msg);
      ui.insertAfterId = msg.id; // keep writing in sequence
    } else {
      msgs.push(msg);
      ui.insertAfterId = null;
    }
    touchStory();
    renderStream(at >= 0 ? { toId: msg.id } : { scroll: 'bottom' });
    renderStories();
  } else {
    persist();
  }
  input.value = '';
  autoGrow(input);
  renderCast();
  updateSpeakerBar();
}

function startEdit(id) {
  ui.editingId = id;
  ui.activeMsgId = null;
  renderStream({ toId: id });
}

function buildEditor(m) {
  const ta = h('textarea', { rows: '1', 'aria-label': 'Edit message' });
  ta.value = m.text;
  const sel = h('select', { class: 'field small', 'aria-label': 'Speaker' },
    h('option', { value: WRITER, text: writerInfo().name + ' (you)' }),
    m.speaker && !tupperById(m.speaker) && h('option', { value: m.speaker, text: (m.speakerName || 'Unknown') + ' (removed)' }),
    [...state.cast].sort(byName).map(t => h('option', { value: t.id, text: tupperInfo(t).name })));
  sel.value = m.speaker || WRITER;

  const done = () => { ui.editingId = null; renderStream(); $('input').focus(); };
  const save = () => {
    const text = ta.value.trim();
    if (!text) { ui.editingId = null; deleteMsg(m.id); return; }
    m.text = text;
    const speaker = sel.value === WRITER ? null : sel.value;
    if (speaker !== m.speaker) {
      m.speaker = speaker;
      m.speakerName = speaker ? tupperById(speaker).name : null;
    }
    touchStory();
    done();
  };
  ta.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); done(); }
    else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
  });
  ta.addEventListener('input', () => autoGrow(ta));
  requestAnimationFrame(() => { autoGrow(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });

  return h('div', { class: 'editor', onclick: e => e.stopPropagation() }, ta,
    h('div', { class: 'editor-row' }, sel,
      h('span', { class: 'muted small spacer', text: 'Enter save · Esc cancel' }),
      h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: done }),
      h('button', { type: 'button', class: 'btn primary', text: 'Save', onclick: save })));
}

function moveMsg(id, delta) {
  const msgs = story().messages;
  const i = msgs.findIndex(m => m.id === id), j = i + delta;
  if (i < 0 || j < 0 || j >= msgs.length) return;
  [msgs[i], msgs[j]] = [msgs[j], msgs[i]];
  ui.activeMsgId = id;
  touchStory();
  renderStream({ toId: id });
}

function deleteMsg(id) {
  const msgs = story().messages;
  const i = msgs.findIndex(m => m.id === id);
  if (i < 0) return;
  const [removed] = msgs.splice(i, 1);
  if (ui.editingId === id) ui.editingId = null;
  if (ui.insertAfterId === id) ui.insertAfterId = i > 0 ? msgs[i - 1].id : null;
  ui.selection.delete(id);
  touchStory();
  renderStream();
  renderStories();
  updateSpeakerBar();
  toast('Message deleted.', { label: 'Undo', run: () => { msgs.splice(i, 0, removed); touchStory(); renderStream({ toId: removed.id }); renderStories(); } });
}

function setInsertAfter(id) {
  ui.insertAfterId = id;
  ui.activeMsgId = null;
  renderStream(id ? { toId: id } : { scroll: 'bottom' });
  updateSpeakerBar();
  $('input').focus();
}

function setLatch(id) {
  state.latch = id;
  persist();
  renderCast();
  updateSpeakerBar();
  document.documentElement.classList.remove('sidebar-open');
  $('input').focus();
}

// ---------------------------------------------------------------------------
// Actions: stories
// ---------------------------------------------------------------------------
function resetUi() {
  ui.editingId = ui.insertAfterId = ui.activeMsgId = null;
  ui.selection.clear();
}
function openStory(id) {
  state.activeStoryId = id;
  resetUi();
  persist();
  renderHeader();
  renderStories();
  renderStream({ scroll: 'bottom' });
  updateSpeakerBar();
  document.documentElement.classList.remove('sidebar-open');
}
function createStory() {
  const st = newStory();
  state.stories.push(st);
  openStory(st.id);
  $('storyTitle').focus();
  $('storyTitle').select();
}
function deleteStory(id) {
  const st = state.stories.find(s => s.id === id);
  if (!st || !confirm(`Delete “${st.title}” and its ${st.messages.length} messages? This can't be undone.`)) return;
  state.stories = state.stories.filter(s => s.id !== id);
  if (!state.stories.length) state.stories.push(newStory());
  if (state.activeStoryId === id) openStory([...state.stories].sort((a, b) => b.updated - a.updated)[0].id);
  else { persist(); renderStories(); }
}

// ---------------------------------------------------------------------------
// Cast editor dialog
// ---------------------------------------------------------------------------
let editingTupperId = null;
let pendingUpload; // undefined = unchanged, '' = removed, data URL = new

function openTupperDialog(id = null) {
  const t = tupperById(id);
  const f = $('tupperForm');
  editingTupperId = t ? t.id : null;
  pendingUpload = undefined;
  $('tupperDialogTitle').textContent = t ? 'Edit ' + (t.nick || t.name) : 'Add a speaker';
  f.name.value = t ? t.name : '';
  f.nick.value = t ? t.nick || '' : '';
  f.tag.value = t ? t.tag || '' : '';
  f.brackets.value = t ? t.brackets.map(([p, s]) => `${p}text${s}`).join('\n') : '';
  f.avatar.value = t ? t.avatar || '' : '';
  f.color.value = (t && safeColor(t.color)) || hashColor((t && t.name) || 'new');
  f.colorAuto.checked = !(t && safeColor(t.color));
  f.side.value = t && t.side === 'right' ? 'right' : 'left';
  f.avatarFile.value = '';
  $('tupperDelete').hidden = !t;
  refreshTupperPreview();
  $('tupperDialog').showModal();
  f.name.focus();
}

function refreshTupperPreview() {
  const f = $('tupperForm');
  const t = tupperById(editingTupperId);
  const upload = pendingUpload !== undefined ? pendingUpload : (t && t.avatarUpload) || '';
  const info = { name: f.name.value || '?', avatar: upload || f.avatar.value.trim(), color: f.colorAuto.checked ? hashColor(f.name.value || 'new') : f.color.value };
  const img = $('tupperAvatarPreview');
  const fallback = initialsAvatar(info.name, info.color);
  img.onerror = () => { img.onerror = null; img.src = fallback; };
  img.src = info.avatar || fallback;
  $('tupperAvatarClear').hidden = !upload;
}

function parseBracketLines(text) {
  const pairs = [], bad = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const i = line.indexOf('text');
    if (i < 0) { bad.push(line); continue; }
    const pair = [line.slice(0, i), line.slice(i + 4)];
    if (pair[0] || pair[1]) pairs.push(pair);
  }
  return { pairs, bad };
}

function saveTupperDialog() {
  const f = $('tupperForm');
  const name = f.name.value.trim();
  if (!name) { f.name.focus(); return false; }
  const { pairs, bad } = parseBracketLines(f.brackets.value);
  if (bad.length) {
    toast(`Each bracket line needs the word “text” where the message goes: ${bad[0]}`);
    f.brackets.focus();
    return false;
  }
  let t = tupperById(editingTupperId);
  if (!t) {
    t = { id: uid(), src: '', groupId: null, avatarUpload: '', description: '' };
    state.cast.push(t);
  }
  Object.assign(t, {
    name, nick: f.nick.value.trim(), tag: f.tag.value.trim(), brackets: pairs,
    avatar: f.avatar.value.trim(), color: f.colorAuto.checked ? '' : f.color.value, side: f.side.value,
  });
  if (pendingUpload !== undefined) t.avatarUpload = pendingUpload;
  flush();
  renderCast();
  renderStream();
  updateSpeakerBar();
  return true;
}

function deleteTupper() {
  const t = tupperById(editingTupperId);
  if (!t) return;
  const used = state.stories.reduce((n, st) => n + st.messages.filter(m => m.speaker === t.id).length, 0);
  const note = used ? ` Their ${used} message${used === 1 ? '' : 's'} will keep the name “${t.name}”.` : '';
  if (!confirm(`Remove ${t.nick || t.name} from the cast?${note}`)) return;
  state.cast = state.cast.filter(x => x.id !== t.id);
  if (state.latch === t.id) state.latch = null;
  $('tupperDialog').close();
  flush();
  renderCast();
  renderStream();
  updateSpeakerBar();
}

// ---------------------------------------------------------------------------
// Settings dialog
// ---------------------------------------------------------------------------
const BOOL_SETTINGS = ['showTimestamps', 'showTags', 'colorNames', 'groupMessages', 'autoLatch', 'imageProxy'];

function openSettings() {
  const f = $('settingsForm'), s = state.settings;
  f.writerName.value = s.writerName;
  f.writerAvatar.value = s.writerAvatar.startsWith('data:') ? '' : s.writerAvatar;
  f.writerAvatar.placeholder = s.writerAvatar.startsWith('data:') ? '(uploaded image)' : 'https://…';
  f.writerSide.value = s.writerSide;
  for (const k of BOOL_SETTINGS) f[k].checked = !!s[k];
  $('settingsDialog').showModal();
}

function readSettingsForm() {
  const f = $('settingsForm'), s = state.settings;
  s.writerName = f.writerName.value.trim() || 'Writer';
  if (f.writerAvatar.value.trim() || !s.writerAvatar.startsWith('data:')) s.writerAvatar = f.writerAvatar.value.trim();
  s.writerSide = f.writerSide.value;
  for (const k of BOOL_SETTINGS) s[k] = f[k].checked;
  persist();
  applyTheme();
  renderCast();
  renderStream();
  updateSpeakerBar();
}

function backupData() {
  flush();
  return JSON.stringify({ app: 'tulpachat', kind: 'backup', v: 1, exported: new Date().toISOString(), state }, null, 2);
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
function plainName(m) { return speakerInfo(m).name; }

const EXPORTS = {
  'md-story': {
    label: 'Story (Markdown)', ext: 'md', mime: 'text/markdown',
    note: 'Name shown once per run of lines; your own lines read as narration.',
    build(st) {
      const out = [`# ${st.title}`, ''];
      let prev = null;
      for (const m of st.messages) {
        const info = speakerInfo(m);
        const text = m.text.replace(/\n/g, '  \n');
        out.push(info.isWriter ? text : (info.key === prev ? text : `**${info.name}:** ${text}`), '');
        prev = info.key;
      }
      return out.join('\n');
    },
  },
  'md-chat': {
    label: 'Chat log (Markdown)', ext: 'md', mime: 'text/markdown',
    note: 'One heading line per speaker turn, messages quoted underneath.',
    build(st) {
      const out = [`# ${st.title}`];
      let prev = null;
      for (const m of st.messages) {
        const info = speakerInfo(m);
        if (info.key !== prev) out.push('', `**${info.name}** · ${new Date(m.ts).toLocaleString()}`);
        out.push(m.text.split('\n').map(l => '> ' + l).join('\n'));
        prev = info.key;
      }
      return out.join('\n') + '\n';
    },
  },
  'txt': {
    label: 'Script (plain text)', ext: 'txt', mime: 'text/plain',
    note: 'Name: line, every message. Markdown symbols are left as typed.',
    build(st) {
      return [st.title, '='.repeat(Math.min(st.title.length, 60)), '',
        ...st.messages.map(m => `${plainName(m)}: ${m.text.replace(/\n/g, '\n    ')}`)].join('\n') + '\n';
    },
  },
  'html': {
    label: 'Web page (current theme)', ext: 'html', mime: 'text/html',
    note: 'A standalone page in the current theme. Avatars are embedded where the image host allows it.',
    build: st => buildHtmlPage(st),
  },
  'json': {
    label: 'Story file (re-importable)', ext: 'tulpachat.json', mime: 'application/json',
    note: 'Give this to someone else with Tulpa Chat: it brings the speakers along.',
    build(st) {
      const ids = new Set(st.messages.map(m => m.speaker).filter(Boolean));
      const cast = state.cast.filter(t => ids.has(t.id)).map(({ id, src, name, nick, tag, brackets, avatar, avatarUpload, color, side }) =>
        ({ id, src, name, nick, tag, brackets, avatar: avatarUpload || avatar, color, side }));
      return JSON.stringify({ app: 'tulpachat', kind: 'story', v: 1, story: { title: st.title, messages: st.messages }, cast }, null, 2);
    },
  },
};

const imageCache = new Map();
// Public image proxy that adds CORS headers. Tupperbox's avatar CDN sends
// none, so without this every avatar in a PNG would fall back to initials.
const IMAGE_PROXY = url => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=160&h=160&fit=cover&output=webp`;

async function fetchDataUrl(url) {
  const res = await fetch(url, { mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer' });
  if (!res.ok) throw new Error(res.status);
  return blobToDataUrl(await res.blob());
}

// Swap avatar URLs for data URLs so exports and PNGs are self-contained.
// Direct fetch first, then the proxy (if allowed), then initials.
async function inlineImages(root) {
  await Promise.all([...root.querySelectorAll('img')].map(async img => {
    const src = img.getAttribute('src') || '';
    if (!src.startsWith('data:')) {
      if (!imageCache.has(src)) {
        let data = '';
        try { data = await fetchDataUrl(src); } catch {
          if (state.settings.imageProxy && /^https?:/i.test(src)) {
            try { data = await fetchDataUrl(IMAGE_PROXY(src)); } catch { /* fall through to initials */ }
          }
        }
        if (data) imageCache.set(src, data);
      }
      img.src = imageCache.get(src) || img.dataset.fallback || '';
    }
    img.onerror = null;
    try { await img.decode(); } catch { /* broken image: html2canvas skips it */ }
  }));
}

async function stylesheetText() {
  try {
    const sheet = [...document.styleSheets].find(s => (s.href || '').endsWith('styles.css'));
    if (sheet) return [...sheet.cssRules].map(r => r.cssText).join('\n');
  } catch { /* file:// in some browsers hides rules */ }
  try { return await (await fetch('styles.css')).text(); } catch { return ''; }
}

async function buildHtmlPage(st) {
  const s = state.settings;
  const inner = h('div', { class: 'stream-inner' });
  renderMessages(inner, st.messages);
  await inlineImages(inner);
  const css = await stylesheetText();
  return `<!doctype html>
<html lang="en" data-theme="${s.theme}" data-layout="${THEMES[s.theme].layout}"${s.colorNames ? ' class="color-names"' : ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(st.title)}</title>
<style>
${css}
</style>
</head>
<body class="export">
<h1 class="export-title">${esc(st.title)}</h1>
<main class="stream">
${inner.outerHTML}
</main>
<script>document.addEventListener('click',function(e){var s=e.target.closest('.spoiler');if(s)s.classList.toggle('revealed');});<\/script>
</body>
</html>
`;
}

let exportBusy = 0;
async function refreshExport() {
  const fmt = EXPORTS[$('exportFormat').value];
  const ticket = ++exportBusy;
  $('exportNote').textContent = fmt.note;
  $('exportPreview').value = 'Building…';
  const text = await fmt.build(story());
  if (ticket === exportBusy) $('exportPreview').value = text;
}

function openExport() {
  flush();
  $('exportDialog').showModal();
  refreshExport();
}

// ---------------------------------------------------------------------------
// Capture (screenshot) mode
// ---------------------------------------------------------------------------
function setCapture(on) {
  ui.capture = on;
  ui.editingId = ui.activeMsgId = null;
  if (!on) ui.selection.clear();
  document.documentElement.classList.toggle('capture', on);
  document.documentElement.classList.remove('sidebar-open');
  $('captureBar').hidden = !on;
  renderCaptureWidths();
  renderStream();
}

function renderCaptureWidths() {
  $('captureWidths').replaceChildren(...CAPTURE_WIDTHS.map(w => h('button', {
    type: 'button', class: 'btn' + (state.settings.captureWidth === w ? ' on' : ''), text: w + 'px',
    onclick: () => { state.settings.captureWidth = w; persist(); applyTheme(); renderCaptureWidths(); },
  })));
}

function updateCaptureInfo() {
  if (!ui.capture) return;
  const n = ui.selection.size;
  $('captureInfo').textContent = n
    ? `${n} message${n === 1 ? '' : 's'} picked.`
    : 'Tap messages to pick them. None picked = whole story.';
}

async function capturePng(mode) {
  const msgs = story().messages.filter(m => !ui.selection.size || ui.selection.has(m.id));
  if (!msgs.length) { toast('Nothing to capture yet.'); return; }
  const frame = $('captureFrame');
  const inner = h('div', { class: 'stream-inner', style: `width:${state.settings.captureWidth}px;max-width:none` });
  frame.replaceChildren(inner);
  renderMessages(inner, msgs);
  try {
    toast('Rendering…');
    await inlineImages(inner);
    if (!window.html2canvas) await loadScript(HTML2CANVAS_URL);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    const canvas = await window.html2canvas(inner, { backgroundColor: bg || null, scale: Math.max(2, window.devicePixelRatio || 1), logging: false });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const filename = `${slug(story().title)}.png`;
    if (mode === 'copy') {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        toast('Image copied — paste it wherever.');
      } catch {
        download(blob, filename);
        toast('This browser won’t copy images, so it downloaded instead.');
      }
    } else {
      download(blob, filename);
      toast('Saved ' + filename);
    }
  } catch (err) {
    toast('Capture failed: ' + err.message + '. You can still screenshot the page as it is.');
  } finally {
    frame.replaceChildren();
  }
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 2 + 'px';
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
function wire() {
  const input = $('input');
  const touch = matchMedia('(hover: none)');

  $('themeSelect').replaceChildren(...Object.entries(THEMES).map(([id, t]) => h('option', { value: id, text: t.label })));
  $('themeSelect').addEventListener('change', e => { state.settings.theme = e.target.value; persist(); applyTheme(); renderStream(); });

  input.addEventListener('input', () => { autoGrow(input); updateSpeakerBar(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    else if (e.key === 'ArrowUp' && !input.value) {
      const last = story().messages[story().messages.length - 1];
      if (last) { e.preventDefault(); startEdit(last.id); }
    } else if (e.key === 'Escape' && ui.insertAfterId) { e.preventDefault(); setInsertAfter(null); }
  });
  $('sendBtn').addEventListener('click', () => { send(); input.focus(); });

  $('stream').addEventListener('click', e => {
    const spoiler = e.target.closest('.spoiler');
    if (spoiler) { spoiler.classList.toggle('revealed'); return; }
    const msg = e.target.closest('.msg');
    if (!msg || e.target.closest('.tools, .editor, a')) return;
    const id = msg.dataset.id;
    if (ui.capture) {
      if (ui.selection.has(id)) ui.selection.delete(id); else ui.selection.add(id);
      msg.classList.toggle('selected');
      updateCaptureInfo();
    } else if (touch.matches) {
      ui.activeMsgId = ui.activeMsgId === id ? null : id;
      renderStream();
    }
  });
  $('stream').addEventListener('dblclick', e => {
    const msg = e.target.closest('.msg');
    if (msg && !ui.capture && !e.target.closest('.editor')) startEdit(msg.dataset.id);
  });

  $('storyTitle').addEventListener('input', e => {
    story().title = e.target.value;
    touchStory();
    renderStories();
    document.title = `${story().title || 'Untitled story'} · Tulpa Chat`;
  });
  $('storyTitle').addEventListener('blur', e => {
    if (!e.target.value.trim()) { story().title = 'Untitled story'; touchStory(); renderHeader(); renderStories(); }
  });
  $('storyTitle').addEventListener('keydown', e => { if (e.key === 'Enter') input.focus(); });

  // Sidebar
  document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
    $('castPanel').hidden = tab.dataset.tab !== 'cast';
    $('storiesPanel').hidden = tab.dataset.tab !== 'stories';
  }));
  $('menuBtn').addEventListener('click', () => document.documentElement.classList.toggle('sidebar-open'));
  $('scrim').addEventListener('click', () => document.documentElement.classList.remove('sidebar-open'));
  $('castFilter').addEventListener('input', renderCast);
  $('importInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) await importFile(file);
  });
  $('addTupperBtn').addEventListener('click', () => openTupperDialog(null));
  $('newStoryBtn').addEventListener('click', createStory);

  // Speaker dialog
  const tf = $('tupperForm');
  tf.addEventListener('submit', e => { e.preventDefault(); if (saveTupperDialog()) $('tupperDialog').close(); });
  $('tupperCancel').addEventListener('click', () => $('tupperDialog').close());
  $('tupperDelete').addEventListener('click', deleteTupper);
  ['name', 'avatar', 'color', 'colorAuto'].forEach(n => tf[n].addEventListener('input', refreshTupperPreview));
  tf.color.addEventListener('input', () => { tf.colorAuto.checked = false; refreshTupperPreview(); });
  tf.avatarFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try { pendingUpload = await fileToAvatar(file); refreshTupperPreview(); } catch (err) { toast(err.message); }
  });
  $('tupperAvatarClear').addEventListener('click', () => { pendingUpload = ''; refreshTupperPreview(); });

  // Settings dialog
  $('settingsBtn').addEventListener('click', openSettings);
  $('settingsForm').addEventListener('submit', e => { e.preventDefault(); readSettingsForm(); $('settingsDialog').close(); });
  $('settingsDialog').addEventListener('close', readSettingsForm);
  $('settingsForm').writerAvatarFile.addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      state.settings.writerAvatar = await fileToAvatar(file);
      $('settingsForm').writerAvatar.value = '';
      $('settingsForm').writerAvatar.placeholder = '(uploaded image)';
      persist();
      renderCast();
      renderStream();
    } catch (err) { toast(err.message); }
  });
  $('backupBtn').addEventListener('click', () => download(backupData(), `tulpachat-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'));
  $('restoreBtn').addEventListener('click', () => { $('settingsDialog').close(); $('importInput').click(); });
  $('wipeBtn').addEventListener('click', () => {
    if (!confirm('Delete every story, speaker and setting in this browser? Download a backup first if you might want them.')) return;
    store.clear();
    state = normaliseState(null);
    resetUi();
    flush();
    $('settingsDialog').close();
    renderAll();
    toast('All data deleted.');
  });

  // Export dialog
  $('exportFormat').replaceChildren(...Object.entries(EXPORTS).map(([id, x]) => h('option', { value: id, text: x.label })));
  $('exportFormat').addEventListener('change', refreshExport);
  $('exportBtn').addEventListener('click', openExport);
  $('exportClose').addEventListener('click', () => $('exportDialog').close());
  $('exportCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('exportPreview').value); toast('Copied.'); }
    catch { $('exportPreview').select(); toast('Select-all done — press Ctrl+C / ⌘C.'); }
  });
  $('exportDownload').addEventListener('click', () => {
    const fmt = EXPORTS[$('exportFormat').value];
    download($('exportPreview').value, `${slug(story().title)}.${fmt.ext}`, fmt.mime);
  });

  // Capture
  $('captureBtn').addEventListener('click', () => setCapture(true));
  $('captureDone').addEventListener('click', () => setCapture(false));
  $('captureClear').addEventListener('click', () => { ui.selection.clear(); renderStream(); });
  $('captureSave').addEventListener('click', () => capturePng('download'));
  $('captureCopy').addEventListener('click', () => capturePng('copy'));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && ui.capture && !document.querySelector('dialog[open]')) setCapture(false);
  });
}

wire();
renderAll();
$('input').focus();

})();
