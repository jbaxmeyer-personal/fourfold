// Run state and rules: shop, bench, board, merges, traits, gauntlet.
import {
  CHAMPS, CHAMP_BY_ID, CLASSES, ORIGINS, shopOdds, ENCOUNTERS, ENCOUNTER_NAMES, BOSS_NAMES,
  TOTAL_FIGHTS, LIVES, START_GOLD, REROLL_COST, BENCH_SIZE, MAX_BOARD, ARCHETYPES, BUFFS,
  endlessSpec, EVENTS, EVENT_AFTER, PAIRS,
} from './data.js';
import { HEX_IDS, parseHex } from './layout.js';

const SAVE_KEY = 'fourfold-save-v3';
const META_KEY = 'fourfold-meta-v1';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Game {
  // opts: { mode: 'gauntlet' | 'daily' | 'endless', asc: 0-5, seed }
  constructor(saved, opts = {}) {
    if (saved) { Object.assign(this, saved); }
    else {
      this.mode = opts.mode || 'gauntlet';
      this.asc = this.mode === 'gauntlet' ? (opts.asc || 0) : 0;
      this.seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 2 ** 32) >>> 0;
      this.day = opts.day || null;
      this.lives = this.asc >= 4 ? 2 : LIVES;
      this.pathPick = null;     // chosen option index for the current fight
      this.event = null;        // pending event choice / state
      this.buffs = {};          // reward buffs: key -> stacks
      this.reward = null;       // pending reward choices after a win
      this.gold = this.asc >= 2 ? 7 : START_GOLD;
      this.fight = 1;
      this.bench = Array(BENCH_SIZE).fill(null);
      this.board = {};          // hexId -> unit
      this.shop = [];
      this.locked = false;
      this.nextUid = 1;
      this.rollCount = 0;
      this.history = [];        // {fight, won} per attempt
      this.rollShop();
    }
    this.buildPath();
  }

  get rerollCost() { return this.asc >= 5 ? 3 : REROLL_COST; }
  get endless() { return this.mode === 'endless'; }
  get totalFights() { return this.endless ? Infinity : TOTAL_FIGHTS; }
  get wins() { return this.history.filter(h => h.won).length; }

  // ---------- Path ----------
  // Two encounter options for the next fight (one for bosses). this.enemy is set once one is picked.
  buildPath() {
    const spec = this.specFor(this.fight);
    if (spec.type === 'boss') this.pathOptions = [this.makeEncounter(this.fight, 0)];
    else this.pathOptions = [this.makeEncounter(this.fight, 0), this.makeEncounter(this.fight, 1)];
    if (this.pathOptions.length === 1) this.pathPick = 0;
    this.enemy = this.pathPick != null ? this.pathOptions[this.pathPick] : null;
  }
  choosePath(i) { this.pathPick = i; this.enemy = this.pathOptions[i]; }

  specFor(fight) {
    if (fight > TOTAL_FIGHTS) return endlessSpec(fight);
    const base = ENCOUNTERS[fight - 1];
    if (this.endless && base.type === 'boss') return { ...base };
    return base;
  }

  rng(tag) { return mulberry32(this.seed ^ Math.imul(tag + 1, 2654435761)); }

  // ---------- Shop ----------
  rollShop() {
    const r = this.rng(1000 + this.rollCount++);
    const odds = shopOdds(this.fight);
    const done = this.maxedIds();
    this.shop = [];
    for (let i = 0; i < 5; i++) {
      let x = r(), cost = 1;
      if (x < odds[0]) cost = 1; else if (x < odds[0] + odds[1]) cost = 2; else cost = 3;
      let pool = CHAMPS.filter(c => c.cost === cost && !done.has(c.id));
      if (!pool.length) pool = CHAMPS.filter(c => !done.has(c.id));
      this.shop.push(pool.length ? pool[Math.floor(r() * pool.length)].id : null);
    }
  }

  // Champions the player already owns at 3 stars never show up in the shop again.
  maxedIds() { return new Set(this.allUnits().filter(u => u.star >= 3).map(u => u.id)); }

  reroll() {
    if (this.gold < this.rerollCost) return false;
    this.gold -= this.rerollCost;
    this.rollShop();
    return true;
  }

  allUnits() {
    return [...this.bench.filter(Boolean), ...Object.values(this.board)];
  }

  boardCount() { return Object.keys(this.board).length; }

  canBuy(i) {
    const id = this.shop[i];
    if (!id) return false;
    const c = CHAMP_BY_ID[id];
    if (this.gold < c.cost) return false;
    if (this.bench.some(s => !s)) return true;
    // Full bench: still allowed if the purchase completes a merge.
    return this.allUnits().filter(u => u.id === id && u.star === 1).length >= 2;
  }

  buy(i) {
    if (!this.canBuy(i)) return null;
    const id = this.shop[i];
    const c = CHAMP_BY_ID[id];
    this.gold -= c.cost;
    this.shop[i] = null;
    const unit = { uid: this.nextUid++, id, star: 1 };
    const slot = this.bench.findIndex(s => !s);
    if (slot >= 0) this.bench[slot] = unit;
    else this._pendingUnit = unit; // merge will absorb it
    const merged = this.checkMerges(unit);
    this._pendingUnit = null;
    if (merged && merged.star >= 3) this.shop = this.shop.map(s => (s === merged.id ? null : s));
    return { unit, merged };
  }

  // Combine 3 copies of the same champion+star into one higher star. Repeats for cascades.
  checkMerges(trigger) {
    let mergedAny = null;
    for (let star = 1; star <= 2; star++) {
      const ids = new Set(this.allUnits().map(u => u.id));
      if (this._pendingUnit) ids.add(this._pendingUnit.id);
      for (const id of ids) {
        const copies = this._locateAll(id, star);
        if (copies.length >= 3) {
          // Keep a board copy if possible, otherwise the first bench copy.
          copies.sort((a, b) => (a.loc.type === 'board' ? -1 : 1) - (b.loc.type === 'board' ? -1 : 1));
          const keep = copies[0];
          for (const c of copies.slice(1, 3)) this._removeAt(c.loc);
          keep.unit.star = star + 1;
          if (keep.loc.type === 'pending') {
            const slot = this.bench.findIndex(s => !s);
            if (slot >= 0) this.bench[slot] = keep.unit;
          }
          mergedAny = keep.unit;
          return this.checkMerges(keep.unit) || mergedAny;
        }
      }
    }
    return mergedAny;
  }

  _locateAll(id, star) {
    const out = [];
    for (const [hex, u] of Object.entries(this.board)) if (u.id === id && u.star === star) out.push({ unit: u, loc: { type: 'board', hex } });
    this.bench.forEach((u, i) => { if (u && u.id === id && u.star === star) out.push({ unit: u, loc: { type: 'bench', i } }); });
    if (this._pendingUnit && this._pendingUnit.id === id && this._pendingUnit.star === star) out.push({ unit: this._pendingUnit, loc: { type: 'pending' } });
    return out;
  }

  _removeAt(loc) {
    if (loc.type === 'board') delete this.board[loc.hex];
    else if (loc.type === 'bench') this.bench[loc.i] = null;
    else if (loc.type === 'pending') this._pendingUnit = null;
  }

  unitAt(loc) {
    if (!loc) return null;
    if (loc.type === 'board') return this.board[loc.hex] || null;
    if (loc.type === 'bench') return this.bench[loc.i] || null;
    return null;
  }

  sellValue(u) { return CHAMP_BY_ID[u.id].cost * 3 ** (u.star - 1); }

  sell(loc) {
    const u = this.unitAt(loc);
    if (!u) return 0;
    this._removeAt(loc);
    const v = this.sellValue(u);
    this.gold += v;
    return v;
  }

  // Move / swap between bench slots and board hexes. Returns error string or null.
  move(from, to) {
    const a = this.unitAt(from);
    if (!a) return 'nothing';
    if (from.type === to.type && (from.hex === to.hex && from.i === to.i)) return null;
    const b = this.unitAt(to);
    if (to.type === 'board' && from.type === 'bench' && !b && this.boardCount() >= MAX_BOARD) {
      return `Max ${MAX_BOARD} champions on the board`;
    }
    // Only one copy of each champion on the board.
    const dupOnBoard = (u, exceptHex) => Object.entries(this.board).some(([h, x]) => h !== exceptHex && x.id === u.id);
    if (to.type === 'board' && from.type === 'bench' && dupOnBoard(a, to.hex)) return `Only one ${CHAMP_BY_ID[a.id].name} on the board`;
    if (b && from.type === 'board' && to.type === 'bench' && dupOnBoard(b, from.hex)) return `Only one ${CHAMP_BY_ID[b.id].name} on the board`;
    this._removeAt(from);
    if (b) this._removeAt(to);
    this._put(to, a);
    if (b) this._put(from, b);
    return null;
  }

  _put(loc, u) {
    if (loc.type === 'board') this.board[loc.hex] = u;
    else this.bench[loc.i] = u;
  }

  // Before a fight, fill empty board slots from the bench.
  autoFill() {
    const melee = new Set(['tank', 'fighter', 'assassin']);
    while (this.boardCount() < MAX_BOARD) {
      const i = this.bench.findIndex(Boolean);
      if (i < 0) break;
      const u = this.bench[i];
      const isMelee = melee.has(CHAMP_BY_ID[u.id].cls);
      const free = HEX_IDS.filter(h => !this.board[h]);
      free.sort((a, b) => {
        const ra = parseHex(a).row, rb = parseHex(b).row;
        return isMelee ? ra - rb : rb - ra;
      });
      this.board[free[0]] = u;
      this.bench[i] = null;
    }
  }

  // ---------- Traits ----------
  static traits(units) {
    const uniq = new Map();
    for (const u of units) uniq.set(u.id, CHAMP_BY_ID[u.id]);
    const counts = {};
    for (const c of uniq.values()) {
      counts[c.cls] = (counts[c.cls] || 0) + 1;
      counts[c.origin] = (counts[c.origin] || 0) + 1;
    }
    const out = [];
    for (const [key, n] of Object.entries(counts)) {
      const def = CLASSES[key] || ORIGINS[key];
      let tier = -1;
      def.thresholds.forEach((t, i) => { if (n >= t) tier = i; });
      out.push({ key, def, count: n, tier, kind: CLASSES[key] ? 'class' : 'origin' });
    }
    out.sort((a, b) => (b.tier - a.tier) || (b.count - a.count) || a.key.localeCompare(b.key));
    return out;
  }

  playerTraits() { return Game.traits(Object.values(this.board)); }

  // ---------- Encounters ----------
  makeEncounter(fight, variant = 0) {
    let enc = { ...this.specFor(fight), stars: [...this.specFor(fight).stars] };
    const r = this.rng(50 + fight * 7 + variant);
    // The second path option is sometimes an elite: one unit a star higher and +7% stats.
    let elite = false;
    if (variant === 1 && fight >= 3 && enc.type !== 'boss' && r() < (this.asc >= 3 ? 0.7 : 0.45)) {
      elite = true;
      const i = enc.stars.indexOf(Math.min(...enc.stars));
      enc.stars[i] = Math.min(3, enc.stars[i] + 1);
      enc.mult += 0.07;
      enc.type = 'elite';
    }
    if (enc.type === 'boss' && this.asc >= 3) { const i = enc.stars.indexOf(2); if (i >= 0) enc.stars[i] = 3; }
    if (this.asc >= 1) enc.mult += 0.08;
    if (this.asc >= 5) enc.mult += 0.07;
    const origins = Object.keys(ORIGINS);
    const theme = origins[Math.floor(r() * origins.length)];
    const archKeys = Object.keys(ARCHETYPES);
    const arch = enc.type === 'normal' ? archKeys[Math.floor(r() * archKeys.length)] : 'balanced';
    const weights = ARCHETYPES[arch].w;
    const maxCost = fight <= 3 ? 1 : fight <= 5 ? 2 : 3;
    void elite;
    const n = enc.stars.length;
    // Elites/boss are fully themed; normal fights lean on the theme and the archetype.
    const themed = enc.type === 'normal' ? Math.min(n, 1 + Math.floor(r() * 2) + (fight > 6 ? 1 : 0)) : n;

    const pick = [];
    const avail = CHAMPS.filter(c => c.cost <= maxCost);
    const take = (pool) => {
      const p = pool.filter(c => !pick.includes(c));
      if (!p.length) return false;
      let tot = p.reduce((s, c) => s + (weights[c.cls] || 1), 0), x = r() * tot;
      for (const c of p) { x -= weights[c.cls] || 1; if (x <= 0) { pick.push(c); return true; } }
      pick.push(p[p.length - 1]);
      return true;
    };
    if (n >= 3 && arch !== 'artillery' && arch !== 'dive') take(avail.filter(c => (c.cls === 'tank' || c.cls === 'fighter') && (enc.type === 'normal' || c.origin === theme)));
    while (pick.length < themed && take(avail.filter(c => c.origin === theme)));
    while (pick.length < n && take(avail));

    const stars = [...enc.stars].sort(() => r() - 0.5).sort((a, b) => (b === 3) - (a === 3));
    const sorted = [...pick].sort((a, b) => a.cost - b.cost);
    const units = sorted.map((c, i) => ({ uid: 1000 + fight * 10 + variant * 5 + i, id: c.id, star: stars[i] }));

    // Placement varies: melee in front, ranged in back, columns shuffled; assassins like corners.
    const shuffle = (arr) => arr.map(v => [r(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
    const free = new Set(HEX_IDS);
    const board = {};
    const prefRows = { tank: [0, 1], fighter: [0, 1], assassin: [0, 2, 1], mage: [2, 1], ranger: [2, 1], support: [2, 1] };
    for (const u of units) {
      const cls = CHAMP_BY_ID[u.id].cls;
      let hex = null;
      for (const row of prefRows[cls]) {
        let cands = shuffle([...free].filter(h => parseHex(h).row === row));
        if (cls === 'assassin') cands.sort((a, b) => [0, 3].includes(parseHex(b).col) - [0, 3].includes(parseHex(a).col));
        if (cands.length) { hex = cands[0]; break; }
      }
      if (!hex) hex = [...free][0];
      free.delete(hex);
      board[hex] = u;
    }
    const names = ENCOUNTER_NAMES[theme];
    let name = enc.type === 'boss' ? BOSS_NAMES[theme] : names[Math.floor(r() * names.length)];
    if (ARCHETYPES[arch].name && enc.type === 'normal') name += ` · ${ARCHETYPES[arch].name}`;
    return { fight, type: enc.type, mult: enc.mult, theme, name, board };
  }

  // Apply a combat result. Returns summary for the UI.
  resolve(won) {
    const enc = this.enemy;
    if (!won) this.lives -= 1;
    this.history.push({ fight: this.fight, won });
    const interest = Math.min(3, Math.floor(this.gold / 10));
    const winBonus = won ? (enc.type === 'elite' ? 3 : 1) : 0;
    const income = 5 + interest + winBonus;
    const result = { won, income, interest, winBonus, fight: this.fight, lives: this.lives, boss: enc.type === 'boss', mode: this.mode };

    if (this.lives <= 0) { result.over = 'defeat'; return result; }
    if (won && !this.endless && this.fight >= TOTAL_FIGHTS) { result.over = 'victory'; return result; }

    this.gold += income;
    const done = this.fight;
    if (won) this.reward = this.makeReward(enc.type);
    // A lost gauntlet boss is replayed; every other fight moves on.
    const replay = !won && enc.type === 'boss' && !this.endless;
    if (!replay) {
      this.fight += 1;
      const evStep = this.endless ? done % 3 === 0 : EVENT_AFTER.includes(done);
      if (evStep) this.event = { options: this.pickEvents(done) };
      this.pathPick = null;
    }
    if (!this.locked) this.rollShop();
    this.locked = false;
    this.buildPath();
    return result;
  }

  // ---------- Events ----------
  pickEvents(fight) {
    const r = this.rng(7000 + fight);
    const keys = Object.keys(EVENTS);
    const a = keys.splice(Math.floor(r() * keys.length), 1)[0];
    const b = keys.splice(Math.floor(r() * keys.length), 1)[0];
    return [a, b];
  }

  startEvent(key) {
    const r = this.rng(7500 + this.fight + this.rollCount);
    const ev = { key };
    if (key === 'merchant') {
      ev.cards = this.randomChamps(5, r);
      ev.freeRerolls = 1;
    }
    this.event = ev;
    return ev;
  }

  randomChamps(n, r) {
    const odds = shopOdds(Math.max(this.fight, 4));
    const maxed = this.maxedIds();
    const out = [];
    for (let i = 0; i < n; i++) {
      const x = r(), cost = x < odds[0] ? 1 : x < odds[0] + odds[1] ? 2 : 3;
      let pool = CHAMPS.filter(c => c.cost === cost && !maxed.has(c.id));
      if (!pool.length) pool = CHAMPS.filter(c => !maxed.has(c.id));
      out.push(pool[Math.floor(r() * pool.length)].id);
    }
    return out;
  }

  merchantPrice(id) { return [0, 1, 1, 2][CHAMP_BY_ID[id].cost]; }

  // Add a fresh 1-star unit to the bench (handles merges, full bench). Returns {ok, merged, err}.
  gainUnit(id) {
    const canMerge = this.allUnits().filter(u => u.id === id && u.star === 1).length >= 2;
    if (!this.bench.some(s => !s) && !canMerge) return { ok: false, err: 'Bench is full' };
    const unit = { uid: this.nextUid++, id, star: 1 };
    const slot = this.bench.findIndex(s => !s);
    if (slot >= 0) this.bench[slot] = unit; else this._pendingUnit = unit;
    const merged = this.checkMerges(unit);
    this._pendingUnit = null;
    if (merged && merged.star >= 3) this.shop = this.shop.map(s => (s === merged.id ? null : s));
    return { ok: true, merged, unit };
  }

  eventAction(action, arg) {
    const ev = this.event;
    if (!ev) return { ok: false };
    const r = this.rng(8000 + this.fight * 13 + this.rollCount++);
    switch (ev.key) {
      case 'merchant': {
        if (action === 'buy') {
          const id = ev.cards[arg];
          if (!id) return { ok: false };
          const price = this.merchantPrice(id);
          if (this.gold < price) return { ok: false, err: 'Not enough gold' };
          const res = this.gainUnit(id);
          if (!res.ok) return res;
          this.gold -= price;
          ev.cards[arg] = null;
          return res;
        }
        if (action === 'reroll') {
          if (ev.freeRerolls > 0) ev.freeRerolls -= 1;
          else if (this.gold >= this.rerollCost) this.gold -= this.rerollCost;
          else return { ok: false, err: 'Not enough gold' };
          ev.cards = this.randomChamps(5, r);
          return { ok: true };
        }
        break;
      }
      case 'altar': {
        // arg: { sacrifice: uid, upgrade: uid }
        const all = this.allLocated();
        const s = all.find(x => x.unit.uid === arg.sacrifice), u = all.find(x => x.unit.uid === arg.upgrade);
        if (!s || !u || s === u || u.unit.star >= 3) return { ok: false, err: 'Pick two different champions' };
        this._removeAt(s.loc);
        u.unit.star += 1;
        this.event = null;
        return { ok: true, upgraded: u.unit };
      }
      case 'gamble': {
        if (this.gold < 5) return { ok: false, err: 'Need 5 gold' };
        this.gold -= 5;
        const win = r() < 0.5;
        if (win) this.gold += 12;
        this.event = null;
        return { ok: true, win };
      }
      case 'shrine': {
        if (this.gold < 6) return { ok: false, err: 'Need 6 gold' };
        this.gold -= 6;
        const keys = Object.keys(BUFFS);
        const buff = keys[Math.floor(r() * keys.length)];
        this.buffs[buff] = (this.buffs[buff] || 0) + 1;
        this.event = null;
        return { ok: true, buff };
      }
      case 'recruit': {
        const id = this.randomChamps(1, r)[0];
        const res = this.gainUnit(id);
        if (res.ok) this.event = null;
        return { ...res, id };
      }
    }
    return { ok: false };
  }

  allLocated() {
    const out = [];
    for (const [hex, u] of Object.entries(this.board)) out.push({ unit: u, loc: { type: 'board', hex } });
    this.bench.forEach((u, i) => { if (u) out.push({ unit: u, loc: { type: 'bench', i } }); });
    return out;
  }

  // Score used for leaderboards.
  score() {
    const cleared = this.history.filter(h => h.won).length;
    return { fight: this.fight, wins: cleared, lives: this.lives };
  }

  // ---------- Rewards (pick 1 of 3 after a win) ----------
  makeReward(type) {
    const r = this.rng(9000 + this.history.length);
    const big = type === 'elite';
    // Champion: often a copy of something you own (helps merges), otherwise a random one.
    const owned = this.allUnits().filter(u => u.star < 3).map(u => u.id);
    const maxed = this.maxedIds();
    const odds = big ? [0.2, 0.4, 0.4] : shopOdds(this.fight);
    let champ;
    if (owned.length && r() < 0.5) champ = owned[Math.floor(r() * owned.length)];
    else {
      const x = r(), cost = x < odds[0] ? 1 : x < odds[0] + odds[1] ? 2 : 3;
      let pool = CHAMPS.filter(c => c.cost === cost && !maxed.has(c.id));
      if (!pool.length) pool = CHAMPS.filter(c => !maxed.has(c.id));
      champ = pool.length ? pool[Math.floor(r() * pool.length)].id : CHAMPS[0].id;
    }
    const gold = (big ? 6 : 3) + Math.ceil(this.fight / 3);
    const keys = Object.keys(BUFFS);
    const buff = keys[Math.floor(r() * keys.length)];
    return { champ, gold, buff };
  }

  claimReward(kind) {
    const rw = this.reward;
    if (!rw) return { ok: false };
    if (kind === 'gold') this.gold += rw.gold;
    else if (kind === 'buff') this.buffs[rw.buff] = (this.buffs[rw.buff] || 0) + 1;
    else if (kind === 'champ') {
      const res = this.gainUnit(rw.champ);
      if (!res.ok) return res;
      this.reward = null;
      return res;
    }
    this.reward = null;
    return { ok: true };
  }

  // ---------- Persistence ----------
  save() {
    const { enemy, pathOptions, _pendingUnit, ...rest } = this;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ }
  }
  static load() {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? new Game(JSON.parse(s)) : null; } catch (e) { return null; }
  }
  static clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
}

// ---------- Meta progression (ascension, records, collection) ----------
export const Meta = {
  data: null,
  load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(localStorage.getItem(META_KEY)) || null; } catch (e) { this.data = null; }
    this.data = Object.assign({ ascUnlocked: 0, clears: {}, endless: [], daily: {}, pairs: [] }, this.data || {});
    return this.data;
  },
  save() { try { localStorage.setItem(META_KEY, JSON.stringify(this.data)); } catch (e) { /* ignore */ } },
  // Called when a run ends. Returns { newBest, unlocked } for the UI.
  recordRun(game, victory) {
    const m = this.load();
    const out = {};
    const team = Object.values(game.board).map(u => ({ id: u.id, star: u.star }));
    const date = new Date().toISOString().slice(0, 10);
    if (game.mode === 'gauntlet' && victory) {
      m.clears[game.asc] = (m.clears[game.asc] || 0) + 1;
      if (game.asc >= m.ascUnlocked && game.asc < 5) { m.ascUnlocked = game.asc + 1; out.unlocked = m.ascUnlocked; }
    }
    if (game.mode === 'endless') {
      const entry = { fight: game.fight, wins: game.wins, date, team };
      m.endless.push(entry);
      m.endless.sort((a, b) => b.fight - a.fight || b.wins - a.wins);
      m.endless = m.endless.slice(0, 10);
      out.rank = m.endless.indexOf(entry) + 1;
      out.newBest = out.rank === 1;
    }
    if (game.mode === 'daily') {
      const score = (victory ? 1000 : 0) + game.wins * 10 + Math.max(0, game.lives);
      const prev = m.daily[game.day];
      if (!prev || score > prev.score) { m.daily[game.day] = { score, wins: game.wins, victory, lives: game.lives, team }; out.newBest = true; }
    }
    this.save();
    return out;
  },
  discoverPair(key) {
    const m = this.load();
    if (m.pairs.includes(key)) return false;
    m.pairs.push(key);
    this.save();
    return true;
  },
};

export function dailySeed(day) {
  let h = 2166136261;
  for (const ch of 'fourfold-daily-' + day) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
