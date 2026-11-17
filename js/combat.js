// Deterministic-ish auto-battle simulation, independent of rendering.
import { CHAMP_BY_ID, CLASS_STATS, STAR_MULT, ABILITY_MULT, CLASSES, ORIGINS } from './data.js';
import { hexPos, rangeToWorld } from './layout.js';
import { Game } from './game.js';

const MOVE_SPEED = 2.4;
const UNIT_RADIUS = 0.45;
const TIME_LIMIT = 40;
const PROJ_SPEED = 13;

function tierVal(traits, key) {
  const t = traits.find(t => t.key === key);
  if (!t || t.tier < 0) return null;
  return t.def.values[t.tier];
}

function makeFighter(u, side, hex, mult) {
  const c = CHAMP_BY_ID[u.id];
  const base = CLASS_STATS[c.cls];
  const costScale = 1 + 0.15 * (c.cost - 1);
  const sm = STAR_MULT[u.star];
  const p = hexPos(side, hex);
  const hp = Math.round(base.hp * costScale * sm * mult);
  return {
    uid: u.uid, id: u.id, star: u.star, side, champ: c, cls: c.cls, origin: c.origin,
    x: p.x, z: p.z, homeHex: hex,
    maxHp: hp, hp,
    ad: base.ad * costScale * sm * mult,
    as: base.as, asBonus: 0, asMul: 1,
    range: rangeToWorld(base.range), melee: base.range <= 1,
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
    dealt: 0, healed: 0,
  };
}

function applyTraits(team, traits, enemyTeam) {
  const tank = tierVal(traits, 'tank');
  const fighter = tierVal(traits, 'fighter');
  const assassin = tierVal(traits, 'assassin');
  const mage = tierVal(traits, 'mage');
  const ranger = tierVal(traits, 'ranger');
  const support = tierVal(traits, 'support');
  const ember = tierVal(traits, 'ember');
  const frost = tierVal(traits, 'frost');
  const storm = tierVal(traits, 'storm');
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

export class Battle {
  constructor(playerBoard, enemy) {
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
    this.units = [...pUnits, ...eUnits];
    this.started = false;
  }

  allies(f) { return this.units.filter(u => u.alive && u.side === f.side); }
  enemies(f) { return this.units.filter(u => u.alive && u.side !== f.side); }
  dist(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
  nearest(f, list) {
    let best = null, bd = Infinity;
    for (const u of list) { const d = this.dist(f, u); if (d < bd) { bd = d; best = u; } }
    return best;
  }
  emit(e) { this.events.push(e); }

  start() {
    this.started = true;
    // Assassins leap to the back of the enemy formation.
    for (const f of this.units) {
      if (f.cls !== 'assassin') continue;
      const foes = this.enemies(f);
      if (!foes.length) continue;
      const back = foes.reduce((a, b) => (Math.abs(b.z) > Math.abs(a.z) ? b : a));
      const dir = f.side === 'player' ? -1 : 1;
      f.x = back.x + (Math.random() - 0.5) * 0.6;
      f.z = back.z + dir * 0.9;
      f.target = back;
      this.emit({ type: 'leap', uid: f.uid });
    }
  }

  step(dt) {
    if (this.over) return;
    if (!this.started) this.start();
    this.time += dt;

    for (const f of this.units) {
      if (!f.alive) continue;
      // Timers
      if (f.shieldT > 0) { f.shieldT -= dt; if (f.shieldT <= 0) f.shield = 0; }
      if (f.chillT > 0) { f.chillT -= dt; if (f.chillT <= 0) f.chill = 0; }
      if (f.buffT > 0) { f.buffT -= dt; if (f.buffT <= 0) f.buffAs = 0; }
      if (f.tauntT > 0) { f.tauntT -= dt; if (f.tauntT <= 0) f.tauntBy = null; }
      f.atkCd -= dt;
      if (f.castLock > 0) { f.castLock -= dt; continue; }
      if (f.stunT > 0) { f.stunT -= dt; continue; }

      // Targeting
      if (f.tauntBy && f.tauntBy.alive) f.target = f.tauntBy;
      if (!f.target || !f.target.alive) f.target = this.nearest(f, this.enemies(f));
      const t = f.target;
      if (!t) continue;

      // Cast
      if (f.mana >= f.maxMana) {
        f.mana = 0;
        f.castLock = 0.35;
        this.emit({ type: 'cast', uid: f.uid, name: f.champ.ability });
        ABILITIES[f.id](f, this, t);
        continue;
      }

      const d = this.dist(f, t);
      f.facing = Math.atan2(t.x - f.x, t.z - f.z);
      if (d > f.range) {
        const step = Math.min(MOVE_SPEED * dt, d - f.range + 0.01);
        f.x += ((t.x - f.x) / d) * step;
        f.z += ((t.z - f.z) / d) * step;
        f.moving = true;
      } else {
        f.moving = false;
        if (f.atkCd <= 0) {
          const as = f.as * (1 + f.asBonus + f.buffAs) * f.asMul * (1 - f.chill);
          f.atkCd = 1 / Math.max(0.2, as);
          this.emit({ type: 'attack', uid: f.uid, tgt: t.uid });
          if (f.melee) this.basicHit(f, t);
          else this.projectiles.push({ id: this.nextProj++, src: f, tgt: t, x: f.x, z: f.z, kind: f.cls, onHit: () => this.basicHit(f, t) });
        }
      }
    }

    // Separation so units don't stack.
    const alive = this.units.filter(u => u.alive);
    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i], b = alive[j];
        let dx = b.x - a.x, dz = b.z - a.z;
        let d = Math.hypot(dx, dz);
        const min = UNIT_RADIUS * 2;
        if (d < min) {
          if (d < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = Math.hypot(dx, dz); }
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
        }
      }
    }

    // Projectiles
    for (const p of this.projectiles) {
      if (p.done) continue;
      if (!p.tgt.alive) { p.done = true; continue; }
      const dx = p.tgt.x - p.x, dz = p.tgt.z - p.z, d = Math.hypot(dx, dz);
      const s = PROJ_SPEED * dt;
      if (d <= s) { p.done = true; p.onHit(); }
      else { p.x += (dx / d) * s; p.z += (dz / d) * s; }
    }
    this.projectiles = this.projectiles.filter(p => !p.done);

    // End check
    const pAlive = this.units.some(u => u.alive && u.side === 'player');
    const eAlive = this.units.some(u => u.alive && u.side === 'enemy');
    if (!pAlive || !eAlive || this.time >= TIME_LIMIT) {
      this.over = true;
      this.winner = pAlive && !eAlive ? 'player' : 'enemy';
      this.timedOut = pAlive && eAlive;
    }
  }

  basicHit(f, t) {
    if (!f.alive) return;
    this.damage(f, t, f.ad, 'phys', { canCrit: true });
    f.mana = Math.min(f.maxMana, f.mana + 10);
  }

  damage(src, tgt, amount, kind, opts = {}) {
    if (!tgt.alive) return 0;
    let dmg = amount * (1 + src.dmgAmp);
    if (opts.ability) dmg *= 1 + src.abilityAmp;
    let crit = false;
    if (opts.forceCrit || (opts.canCrit && Math.random() < src.crit)) { dmg *= src.critDmg; crit = true; }
    if (kind === 'phys') dmg *= 100 / (100 + tgt.armor);
    else if (kind === 'magic') dmg *= 100 / (100 + tgt.mr);
    dmg = Math.round(dmg);
    let toHp = dmg;
    if (tgt.shield > 0) {
      const ab = Math.min(tgt.shield, toHp);
      tgt.shield -= ab; toHp -= ab;
    }
    tgt.hp -= toHp;
    src.dealt += dmg;
    tgt.mana = Math.min(tgt.maxMana, tgt.mana + Math.min(8, dmg * 0.04));
    if (src.vamp > 0 && src.alive) this.heal(src, src, dmg * src.vamp, true);
    this.emit({ type: 'dmg', uid: tgt.uid, amount: dmg, kind, crit });
    if (tgt.hp <= 0) {
      tgt.hp = 0; tgt.alive = false;
      this.emit({ type: 'death', uid: tgt.uid });
    }
    return dmg;
  }

  heal(src, tgt, amount, quiet) {
    if (!tgt.alive) return;
    const h = Math.min(tgt.maxHp - tgt.hp, Math.round(amount));
    if (h <= 0) return;
    tgt.hp += h;
    src.healed += h;
    if (!quiet || h > 25) this.emit({ type: 'heal', uid: tgt.uid, amount: h });
  }

  shieldUnit(tgt, amount, dur = 4) {
    tgt.shield += Math.round(amount);
    tgt.shieldT = Math.max(tgt.shieldT, dur);
    this.emit({ type: 'shield', uid: tgt.uid, amount: Math.round(amount) });
  }

  within(x, z, r, list) { return list.filter(u => Math.hypot(u.x - x, u.z - z) <= r); }

  survivors(side) { return this.units.filter(u => u.alive && u.side === side); }
}

// ---------- Abilities ----------
const fx = (b, e) => b.emit({ type: 'fx', ...e });

export const ABILITIES = {
  kiln(f, b) {
    b.shieldUnit(f, 250 * f.abilityScale);
    for (const e of b.within(f.x, f.z, 2.8, b.enemies(f))) { e.tauntBy = f; e.tauntT = 2.5; e.target = f; }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.8, color: 0xff6a3d });
  },
  hoarfrost(f, b) {
    for (const e of b.within(f.x, f.z, 2.5, b.enemies(f))) {
      b.damage(f, e, 90 * f.abilityScale, 'magic', { ability: true });
      e.stunT = Math.max(e.stunT, 1.5);
    }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.5, color: 0x6fd3ff });
  },
  bulwark(f, b) {
    for (const a of b.within(f.x, f.z, 3.4, b.allies(f))) b.shieldUnit(a, 180 * f.abilityScale);
    for (const e of b.within(f.x, f.z, 3, b.enemies(f))) { e.tauntBy = f; e.tauntT = 2; e.target = f; }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 3.4, color: 0xb78cff });
  },
  icefang(f, b, t) {
    b.damage(f, t, f.ad * 2.4, 'phys', { ability: true });
    t.chill = Math.max(t.chill, 0.4); t.chillT = 3;
    fx(b, { kind: 'burst', uid: t.uid, color: 0x6fd3ff });
  },
  gale(f, b) {
    for (const e of b.within(f.x, f.z, 2.3, b.enemies(f))) b.damage(f, e, f.ad * 1.6, 'phys', { ability: true });
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 2.3, color: 0xb78cff });
  },
  pyre(f, b, t) {
    const d = b.damage(f, t, f.ad * 3.2, 'phys', { ability: true });
    b.heal(f, f, d * 0.4);
    fx(b, { kind: 'burst', uid: t.uid, color: 0xff6a3d });
  },
  flicker(f, b) {
    const foes = b.enemies(f);
    if (!foes.length) return;
    const low = foes.reduce((a, c) => (c.hp < a.hp ? c : a));
    f.x = low.x + (Math.random() - 0.5) * 0.4; f.z = low.z + (f.side === 'player' ? -0.9 : 0.9);
    f.target = low;
    b.emit({ type: 'leap', uid: f.uid });
    b.damage(f, low, f.ad * 2.5, 'phys', { ability: true, canCrit: true });
    fx(b, { kind: 'burst', uid: low.uid, color: 0xb78cff });
  },
  ashblade(f, b, t) {
    const mult = t.hp / t.maxHp < 0.4 ? 6 : 3;
    b.damage(f, t, f.ad * mult, 'phys', { ability: true, canCrit: true });
    fx(b, { kind: 'burst', uid: t.uid, color: 0xff6a3d });
  },
  shiver(f, b, t) {
    b.damage(f, t, f.ad * 4, 'phys', { ability: true, forceCrit: true });
    t.stunT = Math.max(t.stunT, 1);
    fx(b, { kind: 'burst', uid: t.uid, color: 0x6fd3ff });
  },
  cinder(f, b, t) {
    b.damage(f, t, 260 * f.abilityScale, 'magic', { ability: true });
    for (const e of b.within(t.x, t.z, 1.8, b.enemies(f))) if (e !== t) b.damage(f, e, 130 * f.abilityScale, 'magic', { ability: true });
    fx(b, { kind: 'beam', from: f.uid, to: t.uid, color: 0xff6a3d });
    fx(b, { kind: 'ring', x: t.x, z: t.z, r: 1.8, color: 0xff6a3d });
  },
  frostweaver(f, b, t) {
    for (const e of b.within(t.x, t.z, 2.4, b.enemies(f))) {
      b.damage(f, e, 170 * f.abilityScale, 'magic', { ability: true });
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
    f.buffAs = 0.9; f.buffT = 4;
    fx(b, { kind: 'burst', uid: f.uid, color: 0xb78cff });
  },
  flare(f, b) {
    for (let i = 0; i < 5; i++) {
      const foes = b.enemies(f);
      if (!foes.length) break;
      const e = foes[Math.floor(Math.random() * foes.length)];
      b.damage(f, e, f.ad * 1.3, 'phys', { ability: true, canCrit: true });
      fx(b, { kind: 'beam', from: f.uid, to: e.uid, color: 0xff6a3d });
    }
  },
  spark(f, b) {
    const allies = b.allies(f);
    const low = allies.reduce((a, c) => (c.hp / c.maxHp < a.hp / a.maxHp ? c : a));
    b.shieldUnit(low, 220 * f.abilityScale);
    if (low !== f) low.mana = Math.min(low.maxMana, low.mana + 20);
    fx(b, { kind: 'beam', from: f.uid, to: low.uid, color: 0xb78cff });
  },
  hearth(f, b) {
    for (const a of b.allies(f)) b.heal(f, a, 130 * f.abilityScale);
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 6, color: 0x7dff9a });
  },
  aurora(f, b) {
    for (const a of b.allies(f)) { b.heal(f, a, 110 * f.abilityScale); b.shieldUnit(a, 110 * f.abilityScale); }
    fx(b, { kind: 'ring', x: f.x, z: f.z, r: 6, color: 0x9ff0ff });
  },
};
