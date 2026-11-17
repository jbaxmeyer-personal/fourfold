// UI, input, and the main loop.
import { Game } from './game.js';
import { Battle } from './combat.js';
import { Renderer, thumbnail } from './render.js';
import { CHAMPS, CHAMP_BY_ID, CLASSES, ORIGINS, CLASS_STATS, STAR_MULT, TOTAL_FIGHTS, ENCOUNTERS, REROLL_COST, BENCH_SIZE, MAX_BOARD } from './data.js';
import { HEX_IDS } from './layout.js';

const $ = (s) => document.querySelector(s);
const app = $('#app');
const stage = $('#stage');
const renderer = new Renderer(stage, $('#overlay'));

let game = null;
let phase = 'title';       // title | plan | combat | result
let battle = null;
let speed = 1;
let selected = null;       // {kind:'bench',i} | {kind:'board',hex} | {kind:'enemy',hex} | {kind:'shop',i} | {kind:'trait',key}
let endTimer = 0;

// ---------- Helpers ----------
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 1400);
}
const locOf = (s) => (s.kind === 'bench' ? { type: 'bench', i: s.i } : { type: 'board', hex: s.hex });
const unitOf = (s) => {
  if (!s) return null;
  if (s.kind === 'bench') return game.bench[s.i];
  if (s.kind === 'board') return game.board[s.hex];
  if (s.kind === 'enemy') return game.enemy.board[s.hex];
  return null;
};
const sameSel = (a, b) => a && b && a.kind === b.kind && a.i === b.i && a.hex === b.hex;
const stars = (n) => '★'.repeat(n);

// ---------- Rendering ----------
function renderAll() {
  renderTop();
  renderTraits();
  renderBench();
  renderShop();
  renderInfo();
  syncScene();
  $('#reroll').disabled = game.gold < REROLL_COST;
  $('#lock').classList.toggle('on', game.locked);
  $('#lock').textContent = game.locked ? '🔒' : '🔓';
  if (phase === 'plan') game.save();
}

function renderTop() {
  $('#hp').textContent = game.hp;
  $('#gold').textContent = game.gold;
  const enc = game.enemy;
  const tagTxt = enc.type === 'boss' ? 'BOSS' : enc.type === 'elite' ? 'ELITE' : '';
  $('#encName').innerHTML = `${game.fight}/${TOTAL_FIGHTS} · ${ORIGINS[enc.theme].icon} ${enc.name}${tagTxt ? `<span class="tag ${enc.type}">${tagTxt}</span>` : ''}`;
  $('#track').innerHTML = ENCOUNTERS.map((e, i) => {
    const h = game.history[i] || '';
    return `<i class="${e.type} ${h} ${i + 1 === game.fight && phase !== 'title' ? 'cur' : ''}"></i>`;
  }).join('');
}

function renderTraits() {
  const traits = game.playerTraits();
  const el = $('#traits');
  if (!traits.length) { el.innerHTML = '<div class="empty">Place champions on the board to activate traits</div>'; return; }
  el.innerHTML = traits.map(t => {
    const next = t.def.thresholds.find(x => x > t.count);
    const frac = next ? `${t.count}/${next}` : `${t.count}`;
    const cls = t.tier >= 0 ? `active t${Math.min(2, t.tier + (t.def.thresholds.length === 2 && t.tier === 1 ? 1 : 0))}` : '';
    return `<div class="trait ${cls}" data-trait="${t.key}"><span class="ic">${t.def.icon}</span><span class="n">${frac}</span>${t.def.name}</div>`;
  }).join('');
}

function renderBench() {
  const el = $('#bench');
  el.innerHTML = '';
  for (let i = 0; i < BENCH_SIZE; i++) {
    const u = game.bench[i];
    const d = document.createElement('div');
    d.className = 'slot' + (u ? ` filled c${CHAMP_BY_ID[u.id].cost}` : '') + (sameSel(selected, { kind: 'bench', i }) ? ' sel' : '');
    d.dataset.bench = i;
    if (u) d.innerHTML = `<img src="${thumbnail(u.id)}" alt=""><div class="st s${u.star}">${u.star > 1 ? stars(u.star) : ''}</div>`;
    el.appendChild(d);
  }
}

function renderShop() {
  const el = $('#shop');
  const owned = new Set(game.allUnits().map(u => u.id));
  el.innerHTML = game.shop.map((id, i) => {
    if (!id) return `<div class="card empty"></div>`;
    const c = CHAMP_BY_ID[id];
    const poor = game.gold < c.cost ? ' poor' : '';
    return `<div class="card c${c.cost}${poor}${owned.has(id) ? ' owned' : ''}" data-shop="${i}">
      <span class="cost">${c.cost}●</span><img src="${thumbnail(id)}" alt="">
      <div class="nm">${c.name}</div><div class="tr">${CLASSES[c.cls].icon}${ORIGINS[c.origin].icon}</div></div>`;
  }).join('');
}

function unitStats(u, mult = 1) {
  const c = CHAMP_BY_ID[u.id], b = CLASS_STATS[c.cls];
  const cs = 1 + 0.15 * (c.cost - 1), sm = STAR_MULT[u.star];
  return { hp: Math.round(b.hp * cs * sm * mult), ad: Math.round(b.ad * cs * sm * mult), as: b.as, range: b.range, armor: b.armor, mr: b.mr, mana: b.mana };
}

function renderInfo() {
  const el = $('#info');
  if (!selected || phase === 'title') { el.classList.add('hidden'); return; }
  let html = '';
  if (selected.kind === 'trait') {
    const def = CLASSES[selected.key] || ORIGINS[selected.key];
    const t = game.playerTraits().find(x => x.key === selected.key);
    const members = CHAMPS.filter(c => c.cls === selected.key || c.origin === selected.key);
    html = `<div class="head"><div><div class="title">${def.icon} ${def.name}</div><div class="sub">${def.desc}</div></div><button class="close">✕</button></div>
      <div class="tiers">${def.thresholds.map((th, i) => `<div class="${t && t.tier >= i ? 'on' : ''}">(${th}) ${def.tiers[i]}</div>`).join('')}</div>
      <div class="sub" style="margin-top:6px">${members.map(m => `${m.name} (${m.cost}●)`).join(' · ')}</div>`;
  } else {
    let u, mult = 1, own = false;
    if (selected.kind === 'shop') u = { id: game.shop[selected.i], star: 1 };
    else { u = unitOf(selected); own = selected.kind !== 'enemy'; if (selected.kind === 'enemy') mult = game.enemy.mult; }
    if (!u || !u.id) { selected = null; el.classList.add('hidden'); return; }
    const c = CHAMP_BY_ID[u.id], s = unitStats(u, mult);
    html = `<div class="head"><img src="${thumbnail(u.id)}" alt=""><div><div class="title">${c.name} <span style="color:var(--gold)">${stars(u.star)}</span></div>
      <div class="sub">${CLASSES[c.cls].icon} ${CLASSES[c.cls].name} · ${ORIGINS[c.origin].icon} ${ORIGINS[c.origin].name} · ${c.cost}●${selected.kind === 'enemy' ? ' · Enemy' : ''}</div></div><button class="close">✕</button></div>
      <div class="stats"><div><span>HP</span> ${s.hp}</div><div><span>AD</span> ${s.ad}</div><div><span>AS</span> ${s.as.toFixed(2)}</div><div><span>Range</span> ${s.range}</div>
      <div><span>Armor</span> ${s.armor}</div><div><span>MR</span> ${s.mr}</div><div><span>Mana</span> ${s.mana}</div></div>
      <div class="ability"><b>${c.ability}</b> — ${c.desc}${u.star > 1 ? ' <span style="color:var(--dim)">(scaled by stars)</span>' : ''}</div>
      ${own && phase === 'plan' ? `<button class="sell">Sell for ${game.sellValue(u)}●</button>` : ''}
      ${selected.kind === 'shop' ? `<button class="sell" style="background:#14352a;border-color:#1fa874" data-buy="${selected.i}">Buy for ${c.cost}●</button>` : ''}`;
  }
  el.innerHTML = html;
  el.classList.remove('hidden');
}

function syncScene() {
  const list = [];
  for (const [hex, u] of Object.entries(game.board)) list.push({ ...u, side: 'player', hex });
  for (const [hex, u] of Object.entries(game.enemy.board)) list.push({ ...u, side: 'enemy', hex });
  renderer.syncPlanning(list);
  updateHighlights();
}

function updateHighlights(hoverKey) {
  const map = new Map();
  if (phase === 'plan') {
    if (selected && (selected.kind === 'bench' || selected.kind === 'board')) {
      for (const h of HEX_IDS) map.set(`player|${h}`, 'valid');
    }
    if (selected && selected.kind === 'board') map.set(`player|${selected.hex}`, 'selected');
    if (selected && selected.kind === 'enemy') map.set(`enemy|${selected.hex}`, 'selected');
    if (drag && drag.active) for (const h of HEX_IDS) map.set(`player|${h}`, 'valid');
    if (hoverKey) map.set(hoverKey, 'hover');
  }
  renderer.setHighlights(map);
}

// ---------- Actions ----------
function buy(i) {
  if (phase !== 'plan') return;
  const id = game.shop[i];
  if (!id) return;
  if (game.gold < CHAMP_BY_ID[id].cost) { toast('Not enough gold'); return; }
  const res = game.buy(i);
  if (!res) { toast('Bench is full'); return; }
  if (res.merged) toast(`${CHAMP_BY_ID[res.merged.id].name} upgraded to ${stars(res.merged.star)}!`);
  if (selected && selected.kind === 'shop') selected = null;
  renderAll();
}

function sellSel(s) {
  const u = unitOf(s);
  if (!u) return;
  const v = game.sell(locOf(s));
  toast(`Sold ${CHAMP_BY_ID[u.id].name} for ${v}●`);
  selected = null;
  renderAll();
}

function moveTo(from, toSel) {
  const err = game.move(locOf(from), locOf(toSel));
  if (err && err !== 'nothing') toast(err);
  selected = null;
  renderAll();
}

function startFight() {
  if (phase !== 'plan') return;
  game.autoFill();
  if (!game.boardCount()) { toast('Buy a champion first'); return; }
  selected = null;
  renderAll();
  phase = 'combat';
  app.classList.add('combat');
  battle = new Battle(game.board, game.enemy);
  renderer.startBattle(battle);
  renderer.setHighlights(null);
  $('#speed').classList.remove('hidden');
  endTimer = 0;
}

function finishFight() {
  phase = 'result';
  const won = battle.winner === 'player';
  const survivors = battle.survivors('enemy');
  const mine = battle.units.filter(u => u.side === 'player');
  const result = game.resolve(won, survivors);
  const maxDealt = Math.max(1, ...mine.map(u => u.dealt));
  const rows = mine.sort((a, b) => b.dealt - a.dealt).map(u => `<div class="dmgrow"><img src="${thumbnail(u.id)}" alt=""><div style="width:70px">${u.champ.name} ${stars(u.star)}</div>
    <div class="bar"><i style="width:${u.dealt / maxDealt * 100}%"></i></div><div class="v">${u.dealt}</div></div>`).join('');

  if (result.over) { Game.clearSave(); showEnd(result, rows); return; }
  const title = won ? '<h2 class="win">Victory</h2>' : `<h2 class="lose">Defeat</h2><p>${battle.timedOut ? 'Time ran out. ' : ''}You lost <b style="color:#ff8095">${result.dmg} HP</b></p>`;
  modal(`<div class="panel">${title}
    ${rows}
    <p class="gainline">+${result.income}● (5 base${result.winBonus ? ` + ${result.winBonus} win` : ''}${result.interest ? ` + ${result.interest} interest` : ''})</p>
    <button class="btn primary" data-act="continue">Continue</button></div>`);
}

function showEnd(result, rows) {
  const win = result.over === 'victory';
  modal(`<div class="panel">${win ? '<h2 class="win">Gauntlet Cleared!</h2><p>You beat all 12 fights.</p>' : `<h2 class="lose">Run Over</h2><p>Fell at fight ${result.fight} of ${TOTAL_FIGHTS}.</p>`}
    <p>Record: ${game.history.filter(h => h === 'W').length}W – ${game.history.filter(h => h === 'L').length}L · HP left: ${game.hp}</p>
    ${rows}
    <button class="btn primary" data-act="new">New Run</button></div>`);
}

function backToPlan() {
  closeModal();
  phase = 'plan';
  app.classList.remove('combat');
  $('#speed').classList.add('hidden');
  battle = null;
  renderAll();
}

function modal(html) { const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }

function titleScreen() {
  phase = 'title';
  const saved = Game.load();
  const grid = CHAMPS.map(c => `<img src="${thumbnail(c.id)}" alt="${c.name}">`).join('');
  modal(`<div class="panel"><h1>FOURFOLD</h1><p>Four champions. Twelve fights. One gauntlet.</p>
    <div class="champgrid">${grid}</div>
    ${saved ? `<button class="btn primary" data-act="continue-run">Continue Run (fight ${saved.fight})</button>` : ''}
    <button class="btn ${saved ? '' : 'primary'}" data-act="new">New Run</button>
    <div class="how"><b>How to play.</b> Buy champions from the shop and drag them onto your 4-3-4 hex board — only <b>4</b> can fight at once.
    Three copies merge into a ★★ (three ★★ into ★★★). Mix the six classes (Tank, Fighter, Assassin, Mage, Ranger, Support) and three origins
    (Ember, Frost, Storm) to light up trait bonuses at 2/3/4. Position, then hit <b>Fight</b> — combat is automatic.
    Losing costs HP. Survive all 12 fights, including elites and the final boss.
    <br><br>Tap to select · drag to move · long-press a shop card for details · drag onto the shop to sell.</div></div>`);
}

function newRun() {
  Game.clearSave();
  game = new Game();
  selected = null;
  closeModal();
  phase = 'plan';
  renderAll();
}

// ---------- Input ----------
let drag = null; // {sel, x, y, active, timer, longPressed}

function selAtPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const slot = el.closest('[data-bench]');
  if (slot) return { kind: 'bench', i: +slot.dataset.bench };
  const card = el.closest('[data-shop]');
  if (card) return { kind: 'shop', i: +card.dataset.shop };
  if (el.closest('#shopbar')) return { kind: 'shopbar' };
  if (el.closest('#stage') && !el.closest('#info') && !el.closest('#speed')) {
    const hit = renderer.pick(x, y);
    if (hit) return hit.side === 'player' ? { kind: 'board', hex: hit.hex } : { kind: 'enemy', hex: hit.hex };
    return { kind: 'stage' };
  }
  return null;
}

document.addEventListener('pointerdown', (e) => {
  if (phase === 'title' || e.target.closest('#modal') || e.target.closest('button') || e.target.closest('#info')) return;
  const s = selAtPoint(e.clientX, e.clientY);
  if (!s) return;
  drag = { sel: s, x: e.clientX, y: e.clientY, active: false, longPressed: false };
  if (s.kind === 'shop') {
    drag.timer = setTimeout(() => { if (drag && !drag.active) { drag.longPressed = true; selected = s; renderInfo(); } }, 380);
  }
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const movable = phase === 'plan' && (drag.sel.kind === 'bench' || drag.sel.kind === 'board') && unitOf(drag.sel);
  if (!drag.active && movable && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 8) {
    drag.active = true;
    const g = $('#ghost');
    g.querySelector('img').src = thumbnail(unitOf(drag.sel).id);
    g.classList.remove('hidden');
    $('#sellzone').classList.add('show');
    $('#sellzone').textContent = `Drop to sell for ${game.sellValue(unitOf(drag.sel))}●`;
    selected = null;
    renderInfo();
  }
  if (drag.active) {
    const g = $('#ghost');
    g.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
    const over = selAtPoint(e.clientX, e.clientY);
    document.querySelectorAll('.slot.hover').forEach(s => s.classList.remove('hover'));
    $('#sellzone').classList.toggle('hot', !!over && (over.kind === 'shopbar' || over.kind === 'shop'));
    if (over && over.kind === 'bench') document.querySelector(`[data-bench="${over.i}"]`).classList.add('hover');
    updateHighlights(over && over.kind === 'board' ? `player|${over.hex}` : null);
  }
});

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  clearTimeout(drag.timer);
  const d = drag;
  drag = null;
  $('#ghost').classList.add('hidden');
  $('#sellzone').classList.remove('show', 'hot');
  document.querySelectorAll('.slot.hover').forEach(s => s.classList.remove('hover'));
  if (d.active) {
    const over = selAtPoint(e.clientX, e.clientY);
    if (over && (over.kind === 'bench' || over.kind === 'board')) moveTo(d.sel, over);
    else if (over && (over.kind === 'shopbar' || over.kind === 'shop')) sellSel(d.sel);
    else { updateHighlights(); }
    return;
  }
  if (d.longPressed) return;
  onTap(d.sel);
});

window.addEventListener('pointercancel', () => {
  if (drag) clearTimeout(drag.timer);
  drag = null;
  $('#ghost').classList.add('hidden');
  $('#sellzone').classList.remove('show', 'hot');
});

function onTap(s) {
  if (s.kind === 'shop') { if (phase === 'plan') buy(s.i); return; }
  if (s.kind === 'stage' || s.kind === 'shopbar') { selected = null; renderAll(); return; }
  if (s.kind === 'enemy') { selected = game.enemy.board[s.hex] ? s : null; renderInfo(); updateHighlights(); return; }
  if (phase !== 'plan') { selected = unitOf(s) ? s : null; renderInfo(); return; }
  const u = unitOf(s);
  if (selected && (selected.kind === 'bench' || selected.kind === 'board') && !u) { moveTo(selected, s); return; }
  if (u) selected = sameSel(selected, s) ? null : s;
  else selected = null;
  renderBench();
  renderInfo();
  updateHighlights();
}

// Buttons & delegated clicks
$('#reroll').addEventListener('click', () => { if (phase === 'plan' && game.reroll()) renderAll(); else if (phase === 'plan') toast('Not enough gold'); });
$('#lock').addEventListener('click', () => { if (phase !== 'plan') return; game.locked = !game.locked; toast(game.locked ? 'Shop locked for next round' : 'Shop unlocked'); renderAll(); });
$('#fight').addEventListener('click', startFight);
$('#speed').addEventListener('click', () => { speed = speed === 1 ? 2 : speed === 2 ? 4 : 1; $('#speed').textContent = speed + '×'; });
$('#traits').addEventListener('click', (e) => {
  const t = e.target.closest('[data-trait]');
  if (!t) return;
  selected = selected && selected.kind === 'trait' && selected.key === t.dataset.trait ? null : { kind: 'trait', key: t.dataset.trait };
  renderInfo();
});
$('#info').addEventListener('click', (e) => {
  if (e.target.closest('.close')) { selected = null; renderAll(); return; }
  const b = e.target.closest('[data-buy]');
  if (b) { buy(+b.dataset.buy); return; }
  if (e.target.closest('.sell') && selected) sellSel(selected);
});
$('#modal').addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'new') newRun();
  else if (act === 'continue') backToPlan();
  else if (act === 'continue-run') { game = Game.load(); selected = null; closeModal(); phase = 'plan'; renderAll(); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Loop ----------
let last = performance.now();
let acc = 0;
const STEP = 1 / 30;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === 'combat' && battle) {
    acc += dt * speed;
    while (acc >= STEP && !battle.over) {
      battle.step(STEP);
      acc -= STEP;
      for (const e of battle.events) renderer.onEvent(e);
      battle.events.length = 0;
    }
    if (battle.over) {
      endTimer += dt;
      if (endTimer > 1.2) finishFight();
    }
  }
  renderer.update(dt);
  requestAnimationFrame(frame);
}

// Boot: show a demo board behind the title.
game = new Game();
syncScene();
renderTop();
renderTraits();
renderBench();
renderShop();
titleScreen();
requestAnimationFrame(frame);
window.__fourfold = { get game() { return game; }, get phase() { return phase; }, renderer };
