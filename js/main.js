// UI, input, and the main loop.
import { Game, Meta, dailySeed, today } from './game.js';
import { Battle, activePairs } from './combat.js';
import { Renderer, thumbnail } from './render.js';
import { loadModels } from './models.js';
import { CHAMPS, CHAMP_BY_ID, CLASSES, ORIGINS, CLASS_STATS, STAR_MULT, TOTAL_FIGHTS, ENCOUNTERS, BENCH_SIZE, LIVES, BUFFS, ASCENSIONS, EVENTS, PAIRS } from './data.js';
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
// Big centred announcement (merges, pair discoveries).
function banner(title, sub, kind = '') {
  const el = document.createElement('div');
  el.className = `banner ${kind}`;
  el.innerHTML = `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}
function celebrate(u) {
  const c = CHAMP_BY_ID[u.id];
  banner(`${stars(u.star)}`, `${c.name} ${u.star === 3 ? 'is fully upgraded!' : 'upgraded!'}`, u.star === 3 ? 'gold' : 'silver');
  if (navigator.vibrate) try { navigator.vibrate(u.star === 3 ? [30, 40, 60] : 25); } catch (e) { /* ignore */ }
}
// Ultimate callout: small pill at the top of the stage.
function castBanner(uid, name) {
  const f = battle && battle.units.find(u => u.uid === uid);
  if (!f) return;
  const el = document.createElement('div');
  el.className = `castpill ${f.side}`;
  el.innerHTML = `<img src="${thumbnail(f.id)}" alt=""><b>${f.champ.name}</b><span>${name}</span>`;
  const host = $('#casts');
  host.appendChild(el);
  while (host.children.length > 2) host.firstChild.remove();
  setTimeout(() => el.remove(), 1400);
}

const locOf = (s) => (s.kind === 'bench' ? { type: 'bench', i: s.i } : { type: 'board', hex: s.hex });
const unitOf = (s) => {
  if (!s) return null;
  if (s.kind === 'bench') return game.bench[s.i];
  if (s.kind === 'board') return game.board[s.hex];
  if (s.kind === 'enemy') return game.enemy && game.enemy.board[s.hex];
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
  // Never reset unit positions while a fight is running or its result is showing.
  if (phase !== 'combat' && phase !== 'result') syncScene();
  $('#reroll').disabled = game.gold < game.rerollCost;
  $('#reroll span').textContent = game.rerollCost;
  $('#lock').classList.toggle('on', game.locked);
  $('#lock').textContent = game.locked ? '🔒' : '🔓';
  if (phase === 'plan') game.save();
}

const maxLives = () => (game.asc >= 4 ? 2 : LIVES);
const modeLabel = () => (game.mode === 'endless' ? '∞ Endless' : game.mode === 'daily' ? '📅 Daily' : game.asc ? `A${game.asc}` : '');

function renderTop() {
  $('#hp').innerHTML = Array.from({ length: maxLives() }, (_, i) => `<span class="${i < game.lives ? '' : 'lost'}">❤</span>`).join('');
  $('#gold').textContent = game.gold;
  const enc = game.enemy;
  const count = game.mode === 'endless' ? `Fight ${game.fight}` : `${game.fight}/${TOTAL_FIGHTS}`;
  const ml = modeLabel() ? `<span class="tag normal">${modeLabel()}</span> ` : '';
  if (!enc) $('#encName').innerHTML = `${ml}${count} · Choose your path`;
  else {
    const tagTxt = enc.type === 'boss' ? 'BOSS' : enc.type === 'elite' ? 'ELITE' : '';
    $('#encName').innerHTML = `${ml}${count} · ${ORIGINS[enc.theme].icon} ${enc.name}${tagTxt ? `<span class="tag ${enc.type}">${tagTxt}</span>` : ''}`;
  }
  if (game.mode === 'endless') {
    const best = (Meta.load().endless[0] || {}).fight || 0;
    $('#track').innerHTML = `<span class="best">${best ? `Best: fight ${best}` : 'No record yet'}</span>`;
    return;
  }
  $('#track').innerHTML = ENCOUNTERS.map((e, i) => {
    const att = game.history.filter(x => x.fight === i + 1);
    const h = att.length ? (att[att.length - 1].won ? 'W' : 'L') : '';
    return `<i class="${e.type} ${h} ${i + 1 === game.fight && phase !== 'title' ? 'cur' : ''}"></i>`;
  }).join('');
}

function renderTraits() {
  const traits = game.playerTraits();
  const el = $('#traits');
  const buffs = Object.entries(game.buffs || {}).filter(([, n]) => n > 0).map(([k, n]) =>
    `<div class="trait buff" data-buff="${k}"><span class="ic">${BUFFS[k].icon}</span><span class="n">×${n}</span>${BUFFS[k].name}</div>`).join('');
  const found = Meta.load().pairs;
  const pairs = activePairs(Object.values(game.board).map(u => u.id)).filter(p => found.includes(p.key)).map(p =>
    `<div class="trait pair" data-pair="${p.key}"><span class="ic">🔗</span>${p.name}</div>`).join('');
  if (!traits.length) { el.innerHTML = buffs + '<div class="empty">Place champions on the board to activate traits</div>'; return; }
  el.innerHTML = buffs + pairs + traits.map(t => {
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
    d.className = 'slot' + (u ? ` filled c${CHAMP_BY_ID[u.id].cost} o-${CHAMP_BY_ID[u.id].origin}` : '') + (sameSel(selected, { kind: 'bench', i }) ? ' sel' : '');
    d.dataset.bench = i;
    if (u) d.innerHTML = `<img src="${thumbnail(u.id)}" alt=""><div class="st s${u.star}">${u.star > 1 ? stars(u.star) : ''}</div>`;
    el.appendChild(d);
  }
}

function renderShop() {
  const el = $('#shop');
  const owned = new Set(game.allUnits().map(u => u.id));
  el.innerHTML = game.shop.map((id, i) => {
    if (!id) return `<div class="card empty"><div class="ph"></div><div class="nm">&nbsp;</div><div class="tr">&nbsp;</div></div>`;
    const c = CHAMP_BY_ID[id];
    const poor = game.gold < c.cost ? ' poor' : '';
    return `<div class="card c${c.cost} o-${c.origin}${poor}${owned.has(id) ? ' owned' : ''}" data-shop="${i}">
      <span class="cost">${c.cost}●</span><img src="${thumbnail(id)}" alt="">
      <div class="nm">${c.name}</div><div class="tr">${CLASSES[c.cls].icon}${ORIGINS[c.origin].icon}</div></div>`;
  }).join('');
}

function unitStats(u, mult = 1) {
  const c = CHAMP_BY_ID[u.id], b = CLASS_STATS[c.cls];
  const cs = [0, 1, 1.2, 1.32][c.cost], sm = STAR_MULT[u.star], md = c.mod || {};
  return { hp: Math.round(b.hp * cs * sm * mult * (md.hp || 1)), ad: Math.round(b.ad * cs * sm * mult * (md.ad || 1)), as: b.as, range: b.range, armor: b.armor, mr: b.mr, mana: b.mana };
}

function renderInfo() {
  const el = $('#info');
  if (!selected || phase === 'title') { el.classList.add('hidden'); return; }
  let html = '';
  if (selected.kind === 'pair') {
    const pr = PAIRS.find(x => x.key === selected.key);
    html = `<div class="head"><div><div class="title">🔗 ${pr.name}</div><div class="sub">${CHAMP_BY_ID[pr.a].name} + ${CHAMP_BY_ID[pr.b].name}: ${pr.desc}</div></div><button class="close">✕</button></div>`;
  } else if (selected.kind === 'buff') {
    const b = BUFFS[selected.key], n = game.buffs[selected.key] || 0;
    html = `<div class="head"><div><div class="title">${b.icon} ${b.name} ×${n}</div><div class="sub">Run buff: ${b.desc} (per stack)</div></div><button class="close">✕</button></div>`;
  } else if (selected.kind === 'trait') {
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
  if (game.enemy) for (const [hex, u] of Object.entries(game.enemy.board)) list.push({ ...u, side: 'enemy', hex });
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
  if (res.merged) celebrate(res.merged);
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
  if (!game.enemy) { advance(); return; }
  if (!game.boardCount()) { toast(game.bench.some(Boolean) ? 'Drag a champion onto the board first' : 'Buy a champion first'); return; }
  selected = null;
  renderAll();
  phase = 'combat';
  app.classList.add('combat');
  battle = new Battle(game.board, game.enemy, game.buffs);
  acc = 0;
  renderer.startBattle(battle);
  for (const p of battle.playerPairs) if (Meta.discoverPair(p.key)) setTimeout(() => banner(`🔗 Pair discovered: ${p.name}`, p.desc, 'pair'), 300);
  renderer.setHighlights(null);
  $('#speed').classList.remove('hidden');
  endTimer = 0;
}

function statsPanel(mine) {
  const score = (u) => u.dealt + u.healed * 0.8 + u.taken * 0.5;
  const mvp = [...mine].sort((a, b) => score(b) - score(a))[0];
  const tab = (key, label) => {
    const max = Math.max(1, ...mine.map(u => u[key]));
    const rows = [...mine].sort((a, b) => b[key] - a[key]).map(u => `<div class="dmgrow"><img src="${thumbnail(u.id)}" alt=""><div style="width:70px">${u.champ.name} ${stars(u.star)}</div>
      <div class="bar ${key}"><i style="width:${u[key] / max * 100}%"></i></div><div class="v">${u[key]}</div></div>`).join('');
    return `<div class="tabpane" data-pane="${key}" ${key === 'dealt' ? '' : 'hidden'}>${rows}</div>`;
  };
  return `<div class="mvp"><img src="${thumbnail(mvp.id)}" alt=""><div><small>MVP</small><b>${mvp.champ.name} ${stars(mvp.star)}</b>
      <span>${mvp.dealt} dmg · ${mvp.healed} heal/shield · ${mvp.taken} taken</span></div></div>
    <div class="tabs"><button class="tab on" data-tab="dealt">Damage</button><button class="tab" data-tab="healed">Healing</button><button class="tab" data-tab="taken">Tanked</button></div>
    ${tab('dealt')}${tab('healed')}${tab('taken')}`;
}

function finishFight() {
  phase = 'result';
  const won = battle.winner === 'player';
  const mine = battle.units.filter(u => u.side === 'player');
  const result = game.resolve(won);
  const stats = statsPanel(mine);
  if (!result.over) game.save();

  if (result.over) { Game.clearSave(); showEnd(result, stats); return; }
  let title;
  if (won) title = `<h2 class="win">Victory</h2>`;
  else {
    const left = `${result.lives} ${result.lives === 1 ? 'life' : 'lives'} left`;
    title = `<h2 class="lose">Defeat</h2><p>${battle.timedOut ? 'Time ran out. ' : ''}You lost a life — <b style="color:#ff8095">${left}</b>.</p>`
      + (result.boss && game.mode !== 'endless' ? '<p>The boss still stands. Regroup and try again.</p>' : '');
  }
  modal(`<div class="panel">${title}
    ${stats}
    <p class="gainline">+${result.income}● (5 base${result.winBonus ? ` + ${result.winBonus} win` : ''}${result.interest ? ` + ${result.interest} interest` : ''})</p>
    <button class="btn primary" data-act="advance">Continue</button></div>`);
}

// After a fight: reward → event → path choice → planning.
function advance() {
  if (game.reward) return showReward();
  if (game.event && !game.event.key) return showEventChoice();
  if (game.event && game.event.key) return showEvent();
  if (!game.enemy) return showPath();
  backToPlan();
}

function showReward() {
  const rw = game.reward;
  const c = CHAMP_BY_ID[rw.champ], b = BUFFS[rw.buff];
  const owned = game.allUnits().filter(u => u.id === rw.champ).length;
  modal(`<div class="panel"><h2 class="win">Choose a reward</h2><p>Pick one.</p>
    <div class="rewards">
      <button class="rcard" data-reward="champ"><img src="${thumbnail(rw.champ)}" alt=""><b>${c.name}</b>
        <span>${CLASSES[c.cls].icon} ${ORIGINS[c.origin].icon} · ${c.cost}●</span><small>${owned ? `You own ${owned}` : 'Free champion'}</small></button>
      <button class="rcard" data-reward="gold"><div class="big">●</div><b>+${rw.gold} gold</b><span>Spend it now</span><small>&nbsp;</small></button>
      <button class="rcard" data-reward="buff"><div class="big">${b.icon}</div><b>${b.name}</b><span>${b.desc}</span><small>Permanent this run</small></button>
    </div></div>`);
}

function encCard(enc, i) {
  const tag = enc.type === 'boss' ? '<span class="tag boss">BOSS</span>' : enc.type === 'elite' ? '<span class="tag elite">ELITE</span>' : '<span class="tag normal">Normal</span>';
  const units = Object.values(enc.board).map(u => `<div class="pu"><img src="${thumbnail(u.id)}" alt=""><i>${u.star > 1 ? stars(u.star) : ''}</i></div>`).join('');
  const traits = Game.traits(Object.values(enc.board)).filter(t => t.tier >= 0).map(t => `${t.def.icon} ${t.def.name} ${t.count}`).join(' · ') || 'No active traits';
  const reward = enc.type === 'elite' ? 'Tougher · +3 gold on win, richer reward' : enc.type === 'boss' ? 'Final fight' : 'Standard reward';
  return `<button class="pathcard ${enc.type}" data-path="${i}"><div class="ph1">${ORIGINS[enc.theme].icon} <b>${enc.name}</b> ${tag}</div>
    <div class="punits">${units}</div><div class="ptraits">${traits}</div><small>${reward}</small></button>`;
}

function showPath() {
  phase = 'path';
  renderTop();
  const opts = game.pathOptions;
  modal(`<div class="panel"><h2>Choose your path</h2><p>Fight ${game.fight}${game.mode === 'endless' ? '' : ` of ${TOTAL_FIGHTS}`}. You'll see who you're facing.</p>
    <div class="paths">${opts.map(encCard).join('')}</div></div>`);
}

function showEventChoice() {
  const [a, b] = game.event.options;
  const card = (k) => `<button class="rcard" data-event="${k}"><div class="big">${EVENTS[k].icon}</div><b>${EVENTS[k].name}</b><span>${EVENTS[k].desc}</span></button>`;
  modal(`<div class="panel"><h2>A fork in the road</h2><p>Visit one stop, or skip.</p>
    <div class="rewards two">${card(a)}${card(b)}</div>
    <button class="btn" data-act="skip-event">Skip</button></div>`);
}

function showEvent() {
  const ev = game.event;
  const gold = `<p class="gainline">You have ${game.gold}●</p>`;
  if (ev.key === 'merchant') {
    const owned = new Set(game.allUnits().map(u => u.id));
    const cards = ev.cards.map((id, i) => {
      if (!id) return `<div class="card empty"><div class="ph"></div><div class="nm">&nbsp;</div><div class="tr">&nbsp;</div></div>`;
      const c = CHAMP_BY_ID[id];
      return `<div class="card c${c.cost} o-${c.origin}${owned.has(id) ? ' owned' : ''}${game.gold < game.merchantPrice(id) ? ' poor' : ''}" data-merchant="${i}"><span class="cost">${game.merchantPrice(id)}●</span><img src="${thumbnail(id)}" alt="">
        <div class="nm">${c.name}</div><div class="tr">${CLASSES[c.cls].icon}${ORIGINS[c.origin].icon}</div></div>`;
    }).join('');
    modal(`<div class="panel"><h2>🛒 Merchant</h2><p>Discounted champions. Tap to buy.</p>${gold}
      <div class="shopgrid">${cards}</div>
      <button class="btn" data-act="m-reroll">⟳ Reroll ${ev.freeRerolls > 0 ? '(free)' : `(${game.rerollCost}●)`}</button>
      <button class="btn primary" data-act="end-event">Leave</button></div>`);
  } else if (ev.key === 'altar') {
    const units = game.allLocated().map(x => x.unit);
    const pick = ev.sacrifice != null ? 'upgrade' : 'sacrifice';
    const list = units.map(u => {
      const dis = pick === 'upgrade' && (u.uid === ev.sacrifice || u.star >= 3);
      const on = u.uid === ev.sacrifice;
      return `<button class="aunit ${on ? 'on' : ''}" ${dis ? 'disabled' : ''} data-altar="${u.uid}"><img src="${thumbnail(u.id)}" alt=""><span>${CHAMP_BY_ID[u.id].name} ${stars(u.star)}</span></button>`;
    }).join('');
    modal(`<div class="panel"><h2>🕯️ Altar</h2><p>${pick === 'sacrifice' ? 'Choose a champion to <b>sacrifice</b>.' : 'Now choose a champion to <b>raise one star</b>.'}</p>
      <div class="altar">${list || '<p>You have no champions.</p>'}</div>
      <button class="btn" data-act="${ev.sacrifice != null ? 'altar-reset' : 'end-event'}">${ev.sacrifice != null ? 'Back' : 'Leave'}</button></div>`);
  } else {
    const def = EVENTS[ev.key];
    const cost = ev.key === 'gamble' ? 5 : ev.key === 'shrine' ? 6 : 0;
    modal(`<div class="panel"><h2>${def.icon} ${def.name}</h2><p>${def.desc}</p>${cost ? gold : ''}
      <button class="btn primary" data-act="do-event" ${cost && game.gold < cost ? 'disabled' : ''}>${ev.key === 'recruit' ? 'Recruit' : `Pay ${cost}●`}</button>
      <button class="btn" data-act="end-event">Leave</button></div>`);
  }
}

function showEnd(result, stats) {
  const win = result.over === 'victory';
  const rec = Meta.recordRun(game, win);
  if (rec.unlocked) titleAsc = rec.unlocked;
  let head;
  if (game.mode === 'endless') head = `<h2 class="lose">Run Over</h2><p>You reached <b>fight ${game.fight}</b> with ${game.wins} wins.</p>${rec.newBest ? '<p class="gainline">🏆 New endless record!</p>' : rec.rank ? `<p>#${rec.rank} on your board</p>` : ''}`;
  else if (win) head = `<h2 class="win">Gauntlet Cleared!</h2><p>You beat all 12 fights${game.asc ? ` on Ascension ${game.asc}` : ''}.</p>${rec.unlocked ? `<p class="gainline">⬆ Ascension ${rec.unlocked} unlocked!</p>` : ''}`;
  else head = `<h2 class="lose">Run Over</h2><p>Fell at fight ${result.fight} of ${TOTAL_FIGHTS}.</p>`;
  if (game.mode === 'daily') head += `<p>${rec.newBest ? '📅 New best for today!' : 'Daily run complete.'}</p>`;
  modal(`<div class="panel">${head}
    <p>Record: ${game.history.filter(h => h.won).length}W – ${game.history.filter(h => !h.won).length}L</p>
    ${stats}
    <button class="btn primary" data-act="title">Back to title</button></div>`);
}

function backToPlan() {
  closeModal();
  renderer.resetFocus();
  phase = 'plan';
  resetCombatUi();
  renderAll();
}

function modal(html) { const m = $('#modal'); m.innerHTML = html; m.classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }

let titleAsc = null;
function titleScreen() {
  phase = 'title';
  const meta = Meta.load();
  if (titleAsc == null) titleAsc = meta.ascUnlocked;
  const saved = Game.load();
  const clsOrder = Object.keys(CLASSES), orgOrder = Object.keys(ORIGINS);
  const grid = clsOrder.map(k => `<div class="gh">${CLASSES[k].icon}</div>`).join('')
    + orgOrder.map(o => clsOrder.map(k => { const c = CHAMPS.find(x => x.cls === k && x.origin === o);
      return `<img src="${thumbnail(c.id)}" alt="${c.name}" title="${c.name}">`; }).join('')).join('');
  const day = today(), dbest = meta.daily[day];
  const ebest = (meta.endless[0] || {}).fight;
  const savedLabel = saved ? `${saved.mode === 'endless' ? 'Endless' : saved.mode === 'daily' ? 'Daily' : 'Gauntlet'} · fight ${saved.fight}` : '';
  modal(`<div class="panel"><h1>FOURFOLD</h1><p>Four champions. One gauntlet.</p>
    <div class="champgrid">${grid}</div>
    ${saved ? `<button class="btn primary" data-act="continue-run">Continue (${savedLabel})</button>` : ''}
    <div class="modebtn">
      <button class="btn ${saved ? '' : 'primary'}" data-act="new-gauntlet">⚔ Gauntlet <small>${ASCENSIONS[titleAsc].name}</small></button>
      ${meta.ascUnlocked > 0 ? `<div class="ascsel"><button data-act="asc-down">◀</button><span>A${titleAsc}</span><button data-act="asc-up">▶</button></div>` : ''}
    </div>
    ${titleAsc > 0 ? `<p class="ascdesc">${ASCENSIONS.slice(1, titleAsc + 1).map(a => a.desc).join(' ')}</p>` : ''}
    <button class="btn" data-act="new-daily">📅 Daily Run <small>${dbest ? (dbest.victory ? `cleared · ${dbest.lives}❤` : `best ${dbest.wins} wins`) : day}</small></button>
    <button class="btn" data-act="new-endless">∞ Endless <small>${ebest ? `best: fight ${ebest}` : 'how far can you go?'}</small></button>
    <button class="btn" data-act="records">🏆 Records & Collection</button>
    <button class="btn ghost" data-act="how">How to play</button></div>`);
}

function howTo() {
  modal(`<div class="panel"><h2>How to play</h2><div class="how">Buy champions from the shop and drag them onto your 4-3-4 hex board — only <b>4</b> fight at once, one copy each.
    Three copies merge into ★★ (three ★★ into ★★★). Mix the six classes and three origins (Ember, Frost, Storm) to light up trait bonuses.
    Some champion <b>pairs</b> have hidden bonuses — find them all.<br><br>
    Pick your path before each fight: elites are tougher but pay more. Every few fights you'll reach a fork with a Merchant, Altar, Gamble, Shrine or Recruit.<br><br>
    Assassins dive your backline, Fighters peel them, Mages punish Fighters. Win to pick a reward. Lose three fights and the run ends.<br><br>
    <b>Gauntlet</b>: beat the boss at fight 12; clearing it unlocks the next Ascension. <b>Daily</b>: everyone gets the same run today. <b>Endless</b>: keeps getting harder — chase your record.
    <br><br>Tap to select · drag to move · long-press a shop card for details · drag onto the shop to sell.</div>
    <button class="btn primary" data-act="title">Back</button></div>`);
}

function recordsScreen() {
  const m = Meta.load();
  const rows = m.endless.map((e, i) => `<div class="rec"><b>#${i + 1}</b><span>Fight ${e.fight}</span><span>${e.wins}W</span><span class="team">${e.team.map(t => `<img src="${thumbnail(t.id)}" alt="">`).join('')}</span><small>${e.date}</small></div>`).join('') || '<p>No endless runs yet.</p>';
  const days = Object.entries(m.daily).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 7).map(([d, v]) => `<div class="rec"><b>${d.slice(5)}</b><span>${v.victory ? `Cleared · ${v.lives}❤` : `${v.wins} wins`}</span><span class="team">${v.team.map(t => `<img src="${thumbnail(t.id)}" alt="">`).join('')}</span></div>`).join('') || '<p>No daily runs yet.</p>';
  const clears = ASCENSIONS.map((a, i) => `<span class="${i <= m.ascUnlocked ? 'on' : ''}">A${i}${m.clears[i] ? ` ✓${m.clears[i]}` : ''}</span>`).join('');
  const pairs = PAIRS.map(p => m.pairs.includes(p.key)
    ? `<div class="pairc on"><div class="pimgs"><img src="${thumbnail(p.a)}" alt=""><img src="${thumbnail(p.b)}" alt=""></div><b>${p.name}</b><small>${p.desc}</small></div>`
    : `<div class="pairc"><div class="pimgs"><span>?</span><span>?</span></div><b>???</b><small>Undiscovered pair</small></div>`).join('');
  modal(`<div class="panel scroll"><h2>🏆 Records</h2>
    <h3>Endless</h3>${rows}
    <h3>Daily</h3>${days}
    <h3>Ascension</h3><div class="ascrow">${clears}</div>
    <h3>Pairs ${m.pairs.length}/${PAIRS.length}</h3><div class="pairs">${pairs}</div>
    <button class="btn primary" data-act="title">Back</button></div>`);
}

function resetCombatUi() {
  app.classList.remove('combat');
  $('#speed').classList.add('hidden');
  battle = null;
}

function newRun(opts) {
  Game.clearSave();
  game = new Game(null, opts);
  selected = null;
  resetCombatUi();
  renderer.resetFocus();
  advance();
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
  if (s.kind === 'enemy') { selected = game.enemy && game.enemy.board[s.hex] ? s : null; renderInfo(); updateHighlights(); return; }
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
  const pc = e.target.closest('[data-pair]');
  if (pc) { selected = { kind: 'pair', key: pc.dataset.pair }; renderInfo(); return; }
  const bf = e.target.closest('[data-buff]');
  if (bf) { selected = { kind: 'buff', key: bf.dataset.buff }; renderInfo(); return; }
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
  const tb = e.target.closest('[data-tab]');
  if (tb) {
    document.querySelectorAll('#modal .tab').forEach(x => x.classList.toggle('on', x === tb));
    document.querySelectorAll('#modal .tabpane').forEach(x => { x.hidden = x.dataset.pane !== tb.dataset.tab; });
    return;
  }
  const rc = e.target.closest('[data-reward]');
  if (rc) {
    const res = game.claimReward(rc.dataset.reward);
    if (!res.ok) { toast(res.err || 'Can\'t take that'); return; }
    if (res.merged) celebrate(res.merged);
    advance();
    return;
  }
  const pc = e.target.closest('[data-path]');
  if (pc) { game.choosePath(+pc.dataset.path); game.save(); backToPlan(); return; }
  const ec = e.target.closest('[data-event]');
  if (ec) { game.startEvent(ec.dataset.event); showEvent(); return; }
  const mc = e.target.closest('[data-merchant]');
  if (mc) {
    const res = game.eventAction('buy', +mc.dataset.merchant);
    if (!res.ok) toast(res.err || 'Can\'t buy that');
    else if (res.merged) celebrate(res.merged);
    showEvent();
    return;
  }
  const al = e.target.closest('[data-altar]');
  if (al) {
    const uid = +al.dataset.altar, ev = game.event;
    if (ev.sacrifice == null) { ev.sacrifice = uid; showEvent(); return; }
    const res = game.eventAction('do', { sacrifice: ev.sacrifice, upgrade: uid });
    if (!res.ok) { toast(res.err); return; }
    celebrate(res.upgraded);
    advance();
    return;
  }
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'new-gauntlet') newRun({ mode: 'gauntlet', asc: titleAsc });
  else if (act === 'new-daily') { const d = today(); newRun({ mode: 'daily', seed: dailySeed(d), day: d }); }
  else if (act === 'new-endless') newRun({ mode: 'endless' });
  else if (act === 'asc-down') { titleAsc = Math.max(0, titleAsc - 1); titleScreen(); }
  else if (act === 'asc-up') { titleAsc = Math.min(Meta.load().ascUnlocked, titleAsc + 1); titleScreen(); }
  else if (act === 'records') recordsScreen();
  else if (act === 'how') howTo();
  else if (act === 'title') { game = new Game(); resetCombatUi(); renderer.resetFocus(); syncScene(); renderTop(); renderTraits(); renderBench(); renderShop(); titleScreen(); }
  else if (act === 'advance') advance();
  else if (act === 'continue') backToPlan();
  else if (act === 'altar-reset') { game.event.sacrifice = null; showEvent(); }
  else if (act === 'skip-event') { game.event = null; advance(); }
  else if (act === 'end-event') { game.event = null; advance(); }
  else if (act === 'm-reroll') { const r = game.eventAction('reroll'); if (!r.ok) toast(r.err); showEvent(); }
  else if (act === 'do-event') {
    const key = game.event.key;
    const res = game.eventAction('do');
    if (!res.ok) { toast(res.err || 'Can\'t do that'); return; }
    if (key === 'gamble') toast(res.win ? '🎲 You won 12 gold!' : '🎲 Nothing this time…');
    if (key === 'shrine') toast(`⛩️ ${BUFFS[res.buff].icon} ${BUFFS[res.buff].name} blessing!`);
    if (key === 'recruit') { toast(`🤝 ${CHAMP_BY_ID[res.id].name} joins you`); if (res.merged) celebrate(res.merged); }
    advance();
  }
  else if (act === 'continue-run') { game = Game.load(); selected = null; resetCombatUi(); advance(); }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// ---------- Loop ----------
let last = performance.now();
let acc = 0;
let slowmo = 0;
const STEP = 1 / 30;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (phase === 'combat' && battle && !battle.over) {
    acc += dt * speed;
    while (acc >= STEP && !battle.over) {
      battle.step(STEP);
      acc -= STEP;
      for (const e of battle.events) {
        renderer.onEvent(e);
        if (e.type === 'cast') castBanner(e.uid, e.name);
        if (e.type === 'dmg' && e.crit && e.amount >= 120) renderer.shake(Math.min(0.25, e.amount / 1500));
      }
      battle.events.length = 0;
    }
    if (battle.over) {
      acc = 0;
      // Final blow: slow motion and a camera nudge toward it.
      slowmo = 1.1;
      if (battle.lastKill) renderer.focus(battle.lastKill.x, battle.lastKill.z);
    }
  }
  if (phase === 'combat' && battle && battle.over) {
    endTimer += dt;
    if (endTimer > 1.7) finishFight();
  }
  let rdt = dt;
  if (slowmo > 0) { slowmo -= dt; rdt = dt * 0.3; }
  renderer.update(rdt);
  requestAnimationFrame(frame);
}

// Boot: load the 3D models, then show the title over a demo board.
modal(`<div class="panel"><h1>FOURFOLD</h1><p id="loadtxt">Loading champions… 0%</p></div>`);
requestAnimationFrame(frame);
loadModels((p) => { const el = document.getElementById('loadtxt'); if (el) el.textContent = `Loading champions… ${Math.round(p * 100)}%`; })
  .then(() => {
    game = new Game();
    syncScene();
    renderTop();
    renderTraits();
    renderBench();
    renderShop();
    titleScreen();
  })
  .catch((err) => { console.error(err); modal(`<div class="panel"><h2 class="lose">Couldn't load</h2><p>${err && err.message ? err.message : err}</p><button class="btn" onclick="location.reload()">Retry</button></div>`); });
window.__fourfold = { get game() { return game; }, get phase() { return phase; }, renderer, advance, celebrate, banner };
