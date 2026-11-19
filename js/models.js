// Rigged KayKit characters (CC0, Kay Lousberg) with shared animation clips.
import * as THREE from 'three';
import { GLTFLoader, SkeletonUtils } from '../vendor/three-addons.min.js';
import { CHAMP_BY_ID, ORIGINS } from './data.js';

const BASE = 'assets/models/';
const FILES = ['knight', 'barbarian', 'mage', 'rogue', 'rogue_hooded'];
const TARGET_HEIGHT = 1.55;

// Which model and which props each champion uses. Everything else on the model is hidden.
const LOOK = {
  kiln:        { model: 'knight', show: ['1H_Sword', 'Round_Shield'] },
  hoarfrost:   { model: 'knight', show: ['1H_Sword', 'Badge_Shield'] },
  bulwark:     { model: 'knight', show: ['1H_Sword', 'Rectangle_Shield'] },
  icefang:     { model: 'barbarian', show: ['1H_Axe', '1H_Axe_Offhand'] },
  gale:        { model: 'barbarian', show: ['2H_Axe', 'Barbarian_Hat'] },
  pyre:        { model: 'barbarian', show: ['2H_Axe', 'Barbarian_Hat'] },
  flicker:     { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  ashblade:    { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  shiver:      { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  cinder:      { model: 'mage', show: ['1H_Wand', 'Spellbook_open', 'Mage_Hat'] },
  frostweaver: { model: 'mage', show: ['2H_Staff', 'Mage_Hat'] },
  tempest:     { model: 'mage', show: ['1H_Wand', 'Spellbook', 'Mage_Hat'] },
  sleet:       { model: 'rogue', show: ['2H_Crossbow'] },
  bolt:        { model: 'rogue', show: ['1H_Crossbow'] },
  flare:       { model: 'rogue', show: ['2H_Crossbow'] },
  spark:       { model: 'mage', show: ['2H_Staff'] },
  hearth:      { model: 'mage', show: ['2H_Staff'] },
  aurora:      { model: 'mage', show: ['2H_Staff'] },
};
// Props that can be toggled (anything else, e.g. body parts, always shows).
const PROPS = new Set(['1H_Sword_Offhand', 'Badge_Shield', 'Rectangle_Shield', 'Round_Shield', 'Spike_Shield', '1H_Sword', '2H_Sword', 'Knight_Helmet',
  '1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', '2H_Axe', 'Mug', 'Barbarian_Hat',
  'Spellbook', 'Spellbook_open', '1H_Wand', '2H_Staff', 'Mage_Hat',
  'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Knife', 'Throwable']);
const ALWAYS = new Set(['Knight_Helmet']);

// Animation clip names per class.
export const CLIPS = {
  tank:     { idle: 'Idle', run: 'Running_A', attack: '1H_Melee_Attack_Chop', cast: 'Block_Attack' },
  fighter:  { idle: 'Idle', run: 'Running_A', attack: '2H_Melee_Attack_Chop', cast: '2H_Melee_Attack_Spin' },
  assassin: { idle: 'Idle', run: 'Running_A', attack: 'Dualwield_Melee_Attack_Stab', cast: 'Dualwield_Melee_Attack_Slice' },
  mage:     { idle: 'Idle', run: 'Running_A', attack: 'Spellcast_Shoot', cast: 'Spellcast_Long' },
  ranger:   { idle: 'Idle', run: 'Running_A', attack: '2H_Ranged_Shoot', cast: '2H_Ranged_Shooting' },
  support:  { idle: 'Idle', run: 'Running_A', attack: 'Spellcast_Shoot', cast: 'Spellcast_Raise' },
};
const CLASS_OVERRIDES = { icefang: { attack: '1H_Melee_Attack_Chop' }, bolt: { attack: '1H_Ranged_Shoot', cast: '1H_Ranged_Shoot' } };

const sources = {};
let clips = {};

export async function loadModels(onProgress) {
  const loader = new GLTFLoader();
  const all = [...FILES, 'anims'];
  let done = 0;
  await Promise.all(all.map(name => new Promise((res, rej) => {
    loader.load(BASE + name + '.glb', (g) => {
      if (name === 'anims') clips = Object.fromEntries(g.animations.map(c => [c.name, c]));
      else sources[name] = g.scene;
      done++; onProgress && onProgress(done / all.length);
      res();
    }, undefined, rej);
  })));
  // KayKit characters share one scale, so measure the knight's body (no props) and use that for all.
  const knight = sources.knight;
  knight.updateMatrixWorld(true);
  const box = new THREE.Box3();
  knight.traverse(o => { if (o.isMesh && !PROPS.has(o.name)) box.expandByObject(o); });
  const scale = TARGET_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
  for (const scene of Object.values(sources)) scene.userData.scale = scale;
}

// Build an animated character for a champion. Returns a Character.
export function createCharacter(champId) {
  const c = CHAMP_BY_ID[champId];
  const look = LOOK[champId];
  const src = sources[look.model];
  const model = SkeletonUtils.clone(src);
  model.scale.setScalar(src.userData.scale);
  const show = new Set(look.show);
  const materials = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    if (PROPS.has(o.name) && !show.has(o.name) && !ALWAYS.has(o.name)) { o.visible = false; return; }
    // Per-instance materials so hit flashes don't bleed between units.
    o.material = o.material.clone();
    // Repaint the clothing in the origin's colour (Ember / Frost / Storm).
    if (o.material.map) o.material.map = originTexture(o.material.map, c.origin);
    // The barbarian's animal hat is grey fur, so dye it with the origin colour directly.
    if (o.name === 'Barbarian_Hat') { o.material.map = null; o.material.color.set(ORIGINS[c.origin].color).multiplyScalar(0.75); }
    materials.push(o.material);
  });
  return new Character(model, materials, c.cls, champId);
}

// ---------- Origin recolouring ----------
// KayKit textures are palettes of colour swatches. We rotate the hue of every saturated swatch
// (cloth, capes, hats, trims) to the origin hue and tint greys/metal, leaving skin, leather and gold alone.
const ORIGIN_HUE = { ember: 8, frost: 198, storm: 272 };
const texCache = new Map();
function originTexture(tex, origin) {
  const key = tex.uuid + origin;
  if (texCache.has(key)) return texCache.get(key);
  const img = tex.image;
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const px = data.data;
  const target = ORIGIN_HUE[origin] / 360;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (l < 0.13 || l > 0.93) continue;            // eyes, outlines, highlights
    if (d < 0.06) {                                // greys and metals: faction-tinted armour
      const [nr, ng, nb] = hsl2rgb(target, 0.36, l);
      px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
      continue;
    }
    const sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    const deg = h * 360;
    if (deg >= 12 && deg <= 58) continue;          // skin, leather, wood, gold
    const s2 = sat < 0.3 ? Math.max(sat, 0.42) : Math.max(sat, 0.62);
    const [nr, ng, nb] = hsl2rgb(target, s2, l);
    px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
  }
  ctx.putImageData(data, 0, 0);
  // clone() shares the underlying image Source, so give the copy its own Source.
  const out = tex.clone();
  out.source = new THREE.Source(cv);
  out.needsUpdate = true;
  texCache.set(key, out);
  return out;
}
function hsl2rgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 0.5) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => Math.round(v * 255));
}

export class Character {
  constructor(model, materials, cls, champId) {
    this.model = model;
    this.materials = materials;
    this.mixer = new THREE.AnimationMixer(model);
    this.names = { ...CLIPS[cls], ...(CLASS_OVERRIDES[champId] || {}) };
    this.actions = {};
    this.base = null;
    this.oneShot = null;
    this.mixer.addEventListener('finished', (e) => {
      if (this.oneShot && e.action === this.oneShot) {
        if (this.dead) return;
        this.oneShot = null;
        if (this.base) this.base.reset().fadeIn(0.12).play();
        e.action.fadeOut(0.12);
      }
    });
    this.setBase('idle');
  }

  action(name) {
    if (!this.actions[name]) {
      const clip = clips[name];
      if (!clip) return null;
      this.actions[name] = this.mixer.clipAction(clip);
    }
    return this.actions[name];
  }

  setBase(kind) {
    const name = this.names[kind] || kind;
    const a = this.action(name);
    if (!a || a === this.base) return;
    const prev = this.base;
    this.base = a;
    a.setLoop(THREE.LoopRepeat);
    a.timeScale = kind === 'run' ? 1.15 : 1;
    if (this.oneShot) return; // will resume after the one-shot finishes
    a.reset().play();
    if (prev) a.crossFadeFrom(prev, 0.15, false);
  }

  // Play a one-shot clip, squeezed to fit `maxDur` seconds if given.
  play(kind, maxDur) {
    if (this.dead) return;
    const name = this.names[kind] || kind;
    const a = this.action(name);
    if (!a) return;
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    const d = a.getClip().duration;
    a.timeScale = maxDur && d > maxDur ? d / maxDur : 1;
    const from = this.oneShot || this.base;
    a.reset().play();
    if (from && from !== a) a.crossFadeFrom(from, 0.08, false);
    this.oneShot = a;
  }

  die() {
    this.play('Death_A');
    this.dead = true;
  }

  cheer() {
    if (this.dead) return;
    const a = this.action('Cheer');
    if (!a) return;
    a.setLoop(THREE.LoopRepeat);
    const from = this.oneShot || this.base;
    a.reset().play();
    if (from && from !== a) a.crossFadeFrom(from, 0.2, false);
    this.oneShot = null;
    this.base = a;
  }

  update(dt) { this.mixer.update(dt); }
}
