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
  gale:        { model: 'barbarian', show: ['2H_Axe'] },
  pyre:        { model: 'barbarian', show: ['2H_Axe', 'Barbarian_Hat'] },
  flicker:     { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  ashblade:    { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  shiver:      { model: 'rogue_hooded', show: ['Knife', 'Knife_Offhand'] },
  cinder:      { model: 'mage', show: ['1H_Wand', 'Spellbook_open', 'Mage_Hat'] },
  frostweaver: { model: 'mage', show: ['2H_Staff', 'Mage_Hat'] },
  tempest:     { model: 'mage', show: ['1H_Wand', 'Spellbook', 'Mage_Hat'] },
  sleet:       { model: 'rogue', show: ['2H_Crossbow'] },
  bolt:        { model: 'rogue', show: ['1H_Crossbow', 'Knife_Offhand'] },
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
  // Normalise scale once per source model.
  for (const scene of Object.values(sources)) {
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    scene.userData.scale = TARGET_HEIGHT / Math.max(0.01, box.max.y - box.min.y);
  }
}

// Build an animated character for a champion. Returns a Character.
export function createCharacter(champId) {
  const c = CHAMP_BY_ID[champId];
  const look = LOOK[champId];
  const src = sources[look.model];
  const model = SkeletonUtils.clone(src);
  model.scale.setScalar(src.userData.scale);
  const show = new Set(look.show);
  const originColor = new THREE.Color(ORIGINS[c.origin].color);
  const materials = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.frustumCulled = false;
    if (PROPS.has(o.name) && !show.has(o.name) && !ALWAYS.has(o.name)) { o.visible = false; return; }
    // Per-instance materials so hit flashes don't bleed between units.
    o.material = o.material.clone();
    // Origin colour on capes and hats so Ember / Frost / Storm read at a glance, plus a light overall tint.
    if (/Cape|Hat$/.test(o.name)) {
      o.material.map = null;
      o.material.color.copy(originColor).multiplyScalar(0.85);
    } else {
      o.material.color.lerp(originColor, 0.14);
    }
    materials.push(o.material);
  });
  return new Character(model, materials, c.cls, champId);
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
