// Auto-battle simulation on the hex graph, independent of rendering.
// Units occupy one hex at a time, step hex-to-hex, and can body-block each other.
import { CHAMP_BY_ID, CLASS_STATS, STAR_MULT, ABILITY_MULT, BUFFS, PAIRS, ATTACK_ANIM } from './data.js';
import { NODES, NODE_INDEX, ADJ, HOPS } from './layout.js';
import { Game } from './game.js';

const RUN_SPEED = 2.6;      // world units per second (a hex is ~1.73)
const ASSASSIN_SPEED = 4.4;
const BACKLINE = new Set(['mage', 'ranger', 'support']);
const MOVE_PRIORITY = { assassin: 0, fighter: 1, tank: 2 };
const TIME_LIMIT = 45;
const OVERTIME = 25;        // after this, damage ramps up and healing falls off
const PROJ_SPEED = 13;
const MAGE_VS_FIGHTER = 1.25;
export const COST_SCALE = [0, 1, 1.2, 1.32];

function tierVal(traits, key) {
  const t = traits.find(t => t.key === key);
  if (!t || t.tier < 0) return null;
  return t.def.values[t.tier];
}

function makeFighter(u, side, hex, mult) {
  const c = CHAMP_BY_ID[u.id];
  const base = CLASS_STATS[c.cls];
  const costScale = COST_SCALE[c.cost];
  const sm = STAR_MULT[u.star];
  const node = NODE_INDEX(side, hex);
  const mod = c.mod || {};
  const hp = Math.round(base.hp * costScale * sm * mult * (mod.hp || 1));
  return {
    uid: u.uid, id: u.id, star: u.star, side, champ: c, cls: c.cls, origin: c.origin,
    node, x: NODES[node].x, z: NODES[node].z, homeHex: hex,
    move: null, blockedT: 0, prevNode: -1,
    maxHp: hp, hp,
    ad: base.ad * costScale * sm * mult * (mod.ad || 1),
    as: base.as, asBonus: 0, asMul: 1,
    range: base.range, melee: base.range <= 1,
    armor: base.armor, mr: base.mr,
    maxMana: base.mana, mana: base.startMana,
    crit: base.crit, critDmg: 1.5,
    abilityAmp: 0, dmgAmp: 0, vamp: 0,
    abilityScale: ABILITY_MULT[u.star] * mult,
    shield: 0, shieldT: 0,
    stunT: 0, chillT: 0, chill: 0, buffT: 0, buffAs: 0,
    tauntT: 0, tauntBy: null,
    atkCd: 0.2 + Math.random() * 0.3, castLock: 0,
    target: null, alive: true, facing: side === 'player' ? Math.PI : 0,
    dealt: 0, healed: 0, taken: 0,
  };
}

// Hidden champion pairs. Returns the PAIRS active for a team and applies their effects.
export function activePairs(ids) {
  const set = new Set(ids);
  return PAIRS.filter(p => set.has(p.a) && set.has(p.b));
}
function applyPairs(team) {
  const pairs = activePairs(team.map(f => f.id));
  const by = (id) => team.find(f => f.id === id);
  for (const p of pairs) {
    const A = by(p.a), B = by(p.b);
    switch (p.key) {
      case 'forge': for (const f of [A, B]) { f.shield += 200; f.shieldT = 99; } break;
      case 'edge': B.vsChilled = 0.4; break;
      case 'front': for (const f of [A, B]) f.mana = f.maxMana; break;
      case 'flames': for (const f of [A, B]) f.dmgAmp += 0.2; break;
      case 'wardens': for (const f of [A, B]) { f.armor += 30; f.mr += 30; } break;
      case 'pact': for (const f of [A, B]) f.asBonus += 0.25; break;
      case 'static': for (const f of [A, B]) f.mana = Math.min(f.maxMana, f.mana + 40); break;
      case 'wind': B.range += 1; A.asBonus += 0.2; break;
    }
  }
  return pairs;
}

function applyTraits(team, traits, enemyTeam) {
  const v = (k) => tierVal(traits, k);
  const tank = v('tank'), fighter = v('fighter'), assassin = v('assassin'), mage = v('mage'), ranger = v('ranger');
  const support = v('support'), ember = v('ember'), frost = v('frost'), storm = v('storm');
  for (const f of team) {
    if (tank && f.cls === 'tank') { f.maxHp += tank; f.hp += tank; }
    if (fighter && f.cls === 'fighter') f.vamp += fighter;
    if (assassin && f.cls === 'assassin') { f.crit += assassin[0]; f.critDmg += assassin[1]; }
    if (mage && f.cls === 'mage') f.abilityAmp += mage;
    if (ranger && f.cls === 'ranger') f.asBonus += ranger;
    if (support) { f.shield += support; f.shieldT = 99; }
    if (ember && f.origin === 'ember') f.dmgAmp += ember;
    if (storm && f.origin === 'storm') f.mana = Math.max(f.mana, Math.round(f.maxMana * storm));
  }
  if (frost) for (const e of enemyTeam) e.asMul *= (1 - frost);
}

// Permanent run buffs from rewards (player only). buffs: {key: stacks}
function applyBuffs(team, buffs) {
  if (!buffs) return;
  for (const [key, n] of Object.entries(buffs)) {
    const b = BUFFS[key];
    if (b && n > 0) for (const f of team) b.apply(f, n);
  }
}

export class Battle {
  constructor(playerBoard, enemy, buffs) {
    this.time = 0;
    this.events = [];
    this.projectiles = [];
    this.nextProj = 1;
    this.over = false;
    this.winner = null;
    const pUnits = Object.entries(playerBoard).map(([hex, u]) => makeFighter(u, 'player', hex, 1));
    const eUnits = Object.entries(enemy.board).map(([hex, u]) => makeFighter(u, 'enemy', hex, enemy.mult));
    this.playerTraits = Game.traits(Object.values(playerBoard));
    this.enemyTraits = Game.traits(Object.values(enemy.board));
    applyTraits(pUnits, this.playerTraits, eUnits);
    applyTraits(eUnits, this.enemyTraits, pUnits);
    applyBuffs(pUnits, buffs);
    applyBuffs(eUnits, enemy.buffs);
    this.playerPairs = applyPairs(pUnits);
    this.enemyPairs = applyPairs(eUnits);
    this.units = [...pUnits, ...eUnits];
    this.occ = NODES.map(() => null);
    for (const u of this.units) this.occ[u.node] = u;
    this.started = false;
  }

  allies(f) { return this.units.filter(u => u.alive && u.side === f.side); }
  enemies(f) { return this.units.filter(u => u.alive && u.side !== f.side); }
  hops(a, b) { return HOPS[a.node][b.node]; }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  nearest(f, list) {
    let best = null, bh = Infinity, bd = Infinity;
    for (const u of list) {
      const h = this.hops(f, u), d = this.dist(f, u);
      if (h < bh || (h === bh && d < bd)) { bh = h; bd = d; best = u; }
    }
    return best;
  }
  emit(e) { this.events.push(e); }

  // Free node next to `t`, preferring the side away from the attacker's home.
  freeNodeNear(t, f) {
    const opts = ADJ[t.node].filter(n => !this.occ[n] || this.occ[n] === f);
    if (!opts.length) return null;
    const away = f.side === 'player' ? -1 : 1;
    opts.sort((a, b) => NODES[b].z * away - NODES[a].z * away);
    return opts[0];
  }

  start() {
    this.started = true;
    // Assassins run for the enemy backline (handled in pickTarget).
  }

  kill(u) {
    u.hp = 0; u.alive = false;
    if (this.occ[u.node] === u) this.occ[u.node] = null;
    if (u.move && this.occ[u.move.to] === u) this.occ[u.move.to] = null;
    this.emit({ type: 'death', uid: u.uid });
  }

  // Priority targets: assassins hunt the backline, fighters hunt assassins that dived into their half.
  // f.committed means "keep chasing this even if something else is in reach".
  pickTarget(f) {
    f.committed = false;
    if (f.tauntBy && f.tauntBy.alive) { f.target = f.tauntBy; return; }
    let prio = null;
    if (f.cls === 'assassin') prio = this.enemies(f).filter(e => BACKLINE.has(e.cls));
    else if (f.cls === 'fighter') {
      const mySide = f.side === 'player' ? 1 : -1;
      prio = this.enemies(f).filter(e => e.cls === 'assassin' && e.z * mySide > 0);
    }
    if (prio && prio.length) {
      if (!(f.target && f.target.alive && prio.includes(f.target))) f.target = this.nearest(f, prio);
      f.committed = true;
      return;
    }
    if (!f.target || !f.target.alive) f.target = this.nearest(f, this.enemies(f));
  }

  // Shortest route through free hexes to any hex within range of `t`. Returns the first step, or -1 if walled off.
  firstStep(f, t) {
    const goal = (n) => HOPS[n][t.node] <= f.range;
    const prev = new Map([[f.node, -1]]);
    const q = [f.node];
    while (q.length) {
      const c = q.shift();
      // Prefer neighbours that head toward the target so ties break sensibly.
      const nbrs = ADJ[c].filter(n => !this.occ[n] && !prev.has(n))
        .sort((a, b) => HOPS[a][t.node] - HOPS[b][t.node] || Math.hypot(NODES[a].x - t.x, NODES[a].z - t.z) - Math.hypot(NODES[b].x - t.x, NODES[b].z - t.z));
      for (const n of nbrs) {
        prev.set(n, c);
        if (goal(n)) { let s = n; while (prev.get(s) !== f.node) s = prev.get(s); return s; }
        q.push(n);
      }
    }
    return -1;
  }

  // Step one hex along the shortest free route toward the target. Returns true if moving.
  tryStep(f, t, dt) {
    const to = this.firstStep(f, t);
    if (to < 0) {
      f.blockedT += dt;
      // Walled off for a while (and not chasing a priority target): switch to an enemy we can reach.
      if (f.blockedT > 1.2 && !f.committed && !(f.tauntBy && f.tauntBy.alive)) {
        const reachable = this.enemies(f).filter(e => e !== t && this.firstStep(f, e) >= 0);
        if (reachable.length) f.target = this.nearest(f, reachable);
        f.blockedT = 0;
      }
      return false;
    }
    this.occ[f.node] = null;
    this.occ[to] = f;
    const dist = Math.hypot(NODES[to].x - NODES[f.node].x, NODES[to].z - NODES[f.node].z);
    f.move = { from: f.node, to, t: 0, dur: dist / (f.cls === 'assassin' ? ASSASSIN_SPEED : RUN_SPEED) };
    f.prevNode = f.node;
    f.node = to;
    f.blockedT = 0;
    return true;
  }

  step(dt) {
    if (this.over) return;
    if (!this.started) this.start();
    this.time += dt;

    // Action order each tick: assassins first, then fighters, then tanks, then everyone else, so the
    // faster divers win the race for contested hexes. Random within each group so neither team gets an edge.
    const order = [...this.units];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    order.sort((a, b) => (MOVE_PRIORITY[a.cls] ?? 3) - (MOVE_PRIORITY[b.cls] ?? 3));
    for (const f of order) {
      if (!f.alive) continue;
      if (f.shieldT > 0) { f.shieldT -= dt; if (f.shieldT <= 0) f.shield = 0; }
      if (f.chillT > 0) { f.chillT -= dt; if (f.chillT <= 0) f.chill = 0; }
      if (f.buffT > 0) { f.buffT -= dt; if (f.buffT <= 0) f.buffAs = 0; }
      if (f.tauntT > 0) { f.tauntT -= dt; if (f.tauntT <= 0) f.tauntBy = null; }

      if (f.move) {
        const m = f.move;
        m.t += dt / m.dur;
        const a = NODES[m.from], b = NODES[m.to], p = Math.min(1, m.t);
        f.x = a.x + (b.x - a.x) * p;
        f.z = a.z + (b.z - a.z) * p;
        f.facing = Math.atan2(b.x - a.x, b.z - a.z);
        f.moving = true;
        if (p >= 1) f.move = null;
        continue;
      }
      f.moving = false;
      f.atkCd -= dt;
      // Attack wind-up: the hit lands / projectile leaves when the animation gets there.
      if (f.windup && f.stunT > 0) f.windup = null;   // stuns interrupt the swing
      if (f.windup) {
        f.windup.t -= dt;
        if (f.windup.t <= 0) {
          const t0 = f.windup.target;
          f.windup = null;
          if (t0.alive) {
            if (f.melee) this.basicHit(f, t0);
            else this.projectiles.push({ id: this.nextProj++, src: f, tgt: t0, x: f.x, z: f.z, kind: f.cls, side: f.side, onHit: () => this.basicHit(f, t0) });
          }
        }
        continue;
      }
      if (f.castLock > 0) { f.castLock -= dt; continue; }
      if (f.stunT > 0) { f.stunT -= dt; continue; }

      this.pickTarget(f);
      let t = f.target;
      if (!t) continue;
      let inRange = this.hops(f, t) <= f.range;
      const taunted = f.tauntBy && f.tauntBy.alive;
      // Don't walk past enemies: if something else is already in range, fight it instead.
      if (!inRange && !f.committed && !taunted) {
        const near = this.enemies(f).filter(e => this.hops(f, e) <= f.range);
        if (near.length) { t = f.target = this.nearest(f, near); inRange = true; }
      }
      // Chasing a priority target: keep moving toward it. If the way is blocked, hit whoever is in reach
      // (usually the unit in the way) and keep trying to get through.
      if (!inRange) {
        if (this.tryStep(f, t, dt)) continue;
        // No route to the target right now. Hit whoever is in reach; if nobody is, go fight the
        // nearest enemy we can reach. The priority target is re-checked every tick.
        const near = this.enemies(f).filter(e => this.hops(f, e) <= f.range);
        if (near.length) { t = this.nearest(f, near); inRange = true; }
        else {
          const alt = this.enemies(f).filter(e => e !== t && this.firstStep(f, e) >= 0);
          if (alt.length) this.tryStep(f, this.nearest(f, alt), dt);
          continue;
        }
      }

      if (f.mana >= f.maxMana && inRange) {
        f.mana = 0;
        f.castLock = 0.45;
        f.facing = Math.atan2(t.x - f.x, t.z - f.z);
        this.emit({ type: 'cast', uid: f.uid, name: f.champ.ability });
        this.caster = f;
        ABILITIES[f.id](f, this, t);
        this.caster = null;
        continue;
      }
      f.facing = Math.atan2(t.x - f.x, t.z - f.z);
      if (f.atkCd <= 0) {
        const as = f.as * (1 + f.asBonus + f.buffAs) * f.asMul * (1 - f.chill);
        f.atkCd = 1 / Math.max(0.2, as);
        this.emit({ type: 'attack', uid: f.uid, tgt: t.uid, interval: f.atkCd });
        // Same squeeze the renderer applies: the clip plays in min(clip length, 90% of the attack interval).
        const anim = ATTACK_ANIM[f.id] || ATTACK_ANIM[f.cls];
        f.windup = { t: anim.release * Math.min(anim.dur, f.atkCd * 0.9), target: t };
      }
    }

    for (const p of this.projectiles) {
      if (p.done) continue;
      if (!p.tgt.alive) { p.done = true; continue; }
      const dx = p.tgt.x - p.x, dz = p.tgt.z - p.z, d = Math.hypot(dx, dz);
      const s = PROJ_SPEED * dt;
      if (d <= s) { p.done = true; p.onHit(); }
      else { p.x += (dx / d) * s; p.z += (dz / d) * s; }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);

    const pAlive = this.units.some(u => u.alive && u.side === 'player');
    const eAlive = this.units.some(u => u.alive && u.side === 'enemy');
    if (!pAlive || !eAlive || this.time >= TIME_LIMIT) {
      this.over = true;
      this.winner = pAlive && !eAlive ? 'player' : 'enemy';
      this.timedOut = pAlive && eAlive;
      for (const u of this.units) if (u.alive && u.side === this.winner) this.emit({ type: 'cheer', uid: u.uid });
    }
  }

  basicHit(f, t) {
    if (!f.alive) return;
    this.damage(f, t, f.ad, 'phys', { canCrit: true });
    f.mana = Math.min(f.maxMana, f.mana + 10);
  }

  damage(src, tgt, amount, kind, opts = {}) {
    if (!tgt.alive) return 0;
    let dmg = amount * (1 + src.dmgAmp) * this.overtimeAmp();
    if (opts.ability) dmg *= 1 + src.abilityAmp;
    if (opts.ability && src.cls === 'mage' && tgt.cls === 'fighter') dmg *= MAGE_VS_FIGHTER;
    if (src.vsChilled && tgt.chill > 0) dmg *= 1 + src.vsChilled;
    let crit = false;
    if (opts.forceCrit || (opts.canCrit && Math.random() < src.crit)) { dmg *= src.critDmg; crit = true; }
    if (kind === 'phys') dmg *= 100 / (100 + tgt.armor);
    else if (kind === 'magic') dmg *= 100 / (100 + tgt.mr);
    dmg = Math.round(dmg);
    let toHp = dmg;
    if (tgt.shield > 0) { const ab = Math.min(tgt.shield, toHp); tgt.shield -= ab; toHp -= ab; }
    tgt.hp -= toHp;
    src.dealt += dmg;
    tgt.taken += dmg;
    tgt.mana = Math.min(tgt.maxMana, tgt.mana + Math.min(8, dmg * 0.04));
    if (src.vamp > 0 && src.alive) this.heal(src, src, dmg * src.vamp, true);
    this.emit({ type: 'dmg', uid: tgt.uid, amount: dmg, kind, crit, src: src.uid });
    if (tgt.hp <= 0) { this.kill(tgt); this.lastKill = { x: tgt.x, z: tgt.z, by: src.uid }; }
    return dmg;
  }

  heal(src, tgt, amount, quiet) {
    if (!tgt.alive) return;
    const h = Math.min(tgt.maxHp - tgt.hp, Math.round(amount * this.overtimeHeal()));
    if (h <= 0) return;
    tgt.hp += h;
    src.healed += h;
    if (!quiet || h > 25) this.emit({ type: 'heal', uid: tgt.uid, amount: h });
  }

  shieldUnit(tgt, amount, dur = 4) {
    amount *= this.overtimeHeal();
    tgt.shield += Math.round(amount);
    tgt.shieldT = Math.max(tgt.shieldT, dur);
    if (this.caster) this.caster.healed += Math.round(amount);
    this.emit({ type: 'shield', uid: tgt.uid, amount: Math.round(amount) });
  }

  overtimeAmp() { return this.time > OVERTIME ? 1 + 0.15 * (this.time - OVERTIME) : 1; }
  overtimeHeal() { return this.time > OVERTIME ? 0.4 : 1; }
  get inOvertime() { return this.time > OVERTIME; }

  within(x, z, r, list) { return list.filter(u => Math.hypot(u.x - x, u.z - z) <= r); }
  survivors(side) { return this.units.filter(u => u.alive && u.side === side); }
}

// ---------- Abilities ----------
const fx = (b, e) => b.emit({ type: 'fx', ...e });

export const ABILITIES = {
  kiln(f, b) {
    b.shieldUnit(f, 250 * f.abilityScale);
    for (const e of b.within(f.x, f.z, 2.8, b.enemies(f))) { e.tauntBy = f; e.tauntT = 2.5; e.target = f; b.emit({ type: 'status', uid: e.uid, text: 'Taunted!' }); }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.8, color: 0xff6a3d });
  },
  hoarfrost(f, b) {
    for (const e of b.within(f.x, f.z, 2.5, b.enemies(f))) {
      b.damage(f, e, 90 * f.abilityScale, 'magic', { ability: true });
      e.stunT = Math.max(e.stunT, 1.0);
    }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.5, color: 0x6fd3ff });
  },
  bulwark(f, b) {
    for (const a of b.within(f.x, f.z, 3.4, b.allies(f))) b.shieldUnit(a, 150 * f.abilityScale);
    for (const e of b.within(f.x, f.z, 3, b.enemies(f))) { e.tauntBy = f; e.tauntT = 2; e.target = f; b.emit({ type: 'status', uid: e.uid, text: 'Taunted!' }); }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 3.4, color: 0xb78cff });
  },
  icefang(f, b, t) {
    b.damage(f, t, f.ad * 2.4, 'phys', { ability: true });
    t.chill = Math.max(t.chill, 0.4); t.chillT = 3;
    fx(b, { kind: 'burst', uid: t.uid, color: 0x6fd3ff });
  },
  gale(f, b) {
    for (const e of b.within(f.x, f.z, 2.3, b.enemies(f))) b.damage(f, e, f.ad * 1.9, 'phys', { ability: true });
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.3, color: 0xb78cff });
  },
  pyre(f, b, t) {
    const d = b.damage(f, t, f.ad * 2.8, 'phys', { ability: true });
    b.heal(f, f, d * 0.3);
    fx(b, { kind: 'burst', uid: t.uid, color: 0xff6a3d });
  },
  flicker(f, b, t) {
    const d = b.damage(f, t, f.ad * 3, 'phys', { ability: true, canCrit: true });
    if (!t.alive) f.mana = Math.round(f.maxMana * 0.5);
    fx(b, { kind: 'burst', uid: t.uid, color: 0xb78cff });
    return d;
  },
  ashblade(f, b, t) {
    const mult = t.hp / t.maxHp < 0.4 ? 6 : 3;
    b.damage(f, t, f.ad * mult, 'phys', { ability: true, canCrit: true });
    fx(b, { kind: 'burst', uid: t.uid, color: 0xff6a3d });
  },
  shiver(f, b, t) {
    b.damage(f, t, f.ad * 3, 'phys', { ability: true, forceCrit: true });
    t.stunT = Math.max(t.stunT, 0.75);
    fx(b, { kind: 'burst', uid: t.uid, color: 0x6fd3ff });
  },
  cinder(f, b, t) {
    b.damage(f, t, 340 * f.abilityScale, 'magic', { ability: true });
    for (const e of b.within(t.x, t.z, 1.8, b.enemies(f))) if (e !== t) b.damage(f, e, 150 * f.abilityScale, 'magic', { ability: true });
    fx(b, { kind: 'beam', from: f.uid, to: t.uid, color: 0xff6a3d });
    fx(b, { kind: 'ring', x: t.x, z: t.z, r: 1.8, color: 0xff6a3d });
  },
  frostweaver(f, b, t) {
    for (const e of b.within(t.x, t.z, 2.4, b.enemies(f))) {
      b.damage(f, e, 200 * f.abilityScale, 'magic', { ability: true });
      e.stunT = Math.max(e.stunT, 1);
    }
    fx(b, { kind: 'ring', x: t.x, z: t.z, r: 2.4, color: 0x6fd3ff });
  },
  tempest(f, b, t) {
    const hit = [];
    let cur = t, prev = f;
    for (let i = 0; i < 4 && cur; i++) {
      b.damage(f, cur, 240 * f.abilityScale, 'magic', { ability: true });
      fx(b, { kind: 'beam', from: prev.uid, to: cur.uid, color: 0xd8c2ff });
      hit.push(cur); prev = cur;
      cur = b.nearest(cur, b.enemies(f).filter(e => !hit.includes(e)));
    }
  },
  sleet(f, b, t) {
    b.damage(f, t, f.ad * 2.6, 'phys', { ability: true, canCrit: true });
    t.chill = Math.max(t.chill, 0.4); t.chillT = 3;
    fx(b, { kind: 'beam', from: f.uid, to: t.uid, color: 0x6fd3ff });
  },
  bolt(f, b) {
    f.buffAs = 1.0; f.buffT = 5;
    fx(b, { kind: 'burst', uid: f.uid, color: 0xb78cff });
  },
  flare(f, b) {
    for (let i = 0; i < 4; i++) {
      const foes = b.enemies(f);
      if (!foes.length) break;
      const e = foes[Math.floor(Math.random() * foes.length)];
      b.damage(f, e, f.ad * 1.25, 'phys', { ability: true, canCrit: true });
      fx(b, { kind: 'beam', from: f.uid, to: e.uid, color: 0xff6a3d });
    }
  },
  spark(f, b) {
    const allies = b.allies(f);
    const low = allies.reduce((a, c) => (c.hp / c.maxHp < a.hp / a.maxHp ? c : a));
    b.shieldUnit(low, 260 * f.abilityScale);
    if (low !== f) low.mana = Math.min(low.maxMana, low.mana + 30);
    fx(b, { kind: 'beam', from: f.uid, to: low.uid, color: 0xb78cff });
  },
  hearth(f, b) {
    for (const a of b.allies(f)) b.heal(f, a, 180 * f.abilityScale);
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 6, color: 0x7dff9a });
  },
  aurora(f, b) {
    for (const a of b.allies(f)) { b.heal(f, a, 90 * f.abilityScale); b.shieldUnit(a, 90 * f.abilityScale); }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 6, color: 0x9ff0ff });
  },
};
