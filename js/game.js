// Run state and rules: shop, bench, board, merges, traits, gauntlet.
import {
  CHAMPS, CHAMP_BY_ID, CLASSES, ORIGINS, shopOdds, ENCOUNTERS, ENCOUNTER_NAMES, BOSS_NAMES,
  TOTAL_FIGHTS, LIVES, START_GOLD, REROLL_COST, BENCH_SIZE, MAX_BOARD, ARCHETYPES, BUFFS,
} from './data.js';
import { HEX_IDS, parseHex } from './layout.js';

const SAVE_KEY = 'fourfold-save-v2';

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
  constructor(saved) {
    if (saved) { Object.assign(this, saved); }
    else {
      this.seed = (Math.random() * 2 ** 32) >>> 0;
      this.lives = LIVES;
      this.buffs = {};          // reward buffs: key -> stacks
      this.reward = null;       // pending reward choices after a win
      this.gold = START_GOLD;
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
    this.enemy = this.makeEncounter(this.fight);
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
    if (this.gold < REROLL_COST) return false;
    this.gold -= REROLL_COST;
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

  // ---------- Gauntlet ----------
  encounterInfo(fight) { return ENCOUNTERS[fight - 1]; }

  makeEncounter(fight) {
    const enc = ENCOUNTERS[fight - 1];
    if (!enc) return null;
    const r = this.rng(50 + fight);
    const origins = Object.keys(ORIGINS);
    const theme = origins[Math.floor(r() * origins.length)];
    const archKeys = Object.keys(ARCHETYPES);
    const arch = enc.type === 'normal' ? archKeys[Math.floor(r() * archKeys.length)] : 'balanced';
    const weights = ARCHETYPES[arch].w;
    const maxCost = fight <= 3 ? 1 : fight <= 5 ? 2 : 3;
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
    const units = sorted.map((c, i) => ({ uid: 1000 + fight * 10 + i, id: c.id, star: stars[i] }));

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
    const enc = ENCOUNTERS[this.fight - 1];
    if (!won) this.lives -= 1;
    this.history.push({ fight: this.fight, won });
    const interest = Math.min(3, Math.floor(this.gold / 10));
    const winBonus = won ? (enc.type === 'elite' ? 3 : 1) : 0;
    const income = 5 + interest + winBonus;
    const result = { won, income, interest, winBonus, fight: this.fight, lives: this.lives, boss: enc.type === 'boss' };

    if (this.lives <= 0) { result.over = 'defeat'; return result; }
    if (won && this.fight >= TOTAL_FIGHTS) { result.over = 'victory'; return result; }

    this.gold += income;
    if (won) { this.fight += 1; this.reward = this.makeReward(enc.type); }
    // A lost boss fight is replayed; other losses move on.
    else if (enc.type !== 'boss') this.fight += 1;
    if (!this.locked) this.rollShop();
    this.locked = false;
    this.enemy = this.makeEncounter(this.fight);
    return result;
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
      const id = rw.champ;
      const canMerge = this.allUnits().filter(u => u.id === id && u.star === 1).length >= 2;
      if (!this.bench.some(s => !s) && !canMerge) return { ok: false, err: 'Bench is full' };
      const unit = { uid: this.nextUid++, id, star: 1 };
      const slot = this.bench.findIndex(s => !s);
      if (slot >= 0) this.bench[slot] = unit; else this._pendingUnit = unit;
      const merged = this.checkMerges(unit);
      this._pendingUnit = null;
      if (merged && merged.star >= 3) this.shop = this.shop.map(s => (s === merged.id ? null : s));
      this.reward = null;
      return { ok: true, merged };
    }
    this.reward = null;
    return { ok: true };
  }

  // ---------- Persistence ----------
  save() {
    const { enemy, _pendingUnit, ...rest } = this;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(rest)); } catch (e) { /* ignore */ }
  }
  static load() {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? new Game(JSON.parse(s)) : null; } catch (e) { return null; }
  }
  static clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }
}
