// Three.js scene: board, low-poly champions, combat visuals, DOM overlays.
import * as THREE from 'three';
import { CHAMP_BY_ID, ORIGINS } from './data.js';
import { R, HEX_IDS, hexPos, GAP } from './layout.js';

const TEAM_COLOR = { player: 0x3ddc97, enemy: 0xff4d6d };

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.55, metalness: 0.08, ...extra });
}
function mesh(geo, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

// ---------- Champion models (built from primitives, facing +z) ----------
export function buildModel(champId) {
  const c = CHAMP_BY_ID[champId];
  const oc = ORIGINS[c.origin].color;
  const main = mat(oc);
  const dark = mat(0x262b40);
  const skin = mat(0xf0dcc0);
  const metal = mat(0xd3d8e2, { metalness: 0.55, roughness: 0.28 });
  const wood = mat(0x8a5a32);
  const glow = mat(oc, { emissive: oc, emissiveIntensity: 0.9 });
  const eye = mat(0x111111);
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);
  const parts = {};
  const eyes = (y, z, spread = 0.09, m = eye) => {
    body.add(mesh(new THREE.SphereGeometry(0.045, 6, 4), m, -spread, y, z));
    body.add(mesh(new THREE.SphereGeometry(0.045, 6, 4), m, spread, y, z));
  };
  const legs = (m, w = 0.22, h = 0.45, sx = 0.2) => {
    body.add(mesh(new THREE.BoxGeometry(w, h, w * 1.1), m, -sx, h / 2, 0));
    body.add(mesh(new THREE.BoxGeometry(w, h, w * 1.1), m, sx, h / 2, 0));
  };

  switch (c.cls) {
    case 'tank': {
      legs(dark, 0.3, 0.45, 0.25);
      body.add(mesh(new THREE.BoxGeometry(1.0, 0.85, 0.7), main, 0, 0.85, 0));
      body.add(mesh(new THREE.IcosahedronGeometry(0.3, 0), main, -0.6, 1.2, 0));
      body.add(mesh(new THREE.IcosahedronGeometry(0.3, 0), main, 0.6, 1.2, 0));
      body.add(mesh(new THREE.BoxGeometry(0.48, 0.42, 0.48), dark, 0, 1.48, 0));
      body.add(mesh(new THREE.BoxGeometry(0.36, 0.08, 0.05), glow, 0, 1.5, 0.25));
      const shield = mesh(new THREE.BoxGeometry(0.8, 1.0, 0.12), metal, -0.15, 0.85, 0.5);
      shield.rotation.y = 0.15;
      body.add(shield);
      body.add(mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), main, -0.15, 0.9, 0.57));
      break;
    }
    case 'fighter': {
      legs(dark);
      body.add(mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.75, 6), main, 0, 0.82, 0));
      body.add(mesh(new THREE.IcosahedronGeometry(0.26, 0), skin, 0, 1.42, 0));
      body.add(mesh(new THREE.ConeGeometry(0.22, 0.32, 5), main, 0, 1.72, -0.02));
      eyes(1.45, 0.22);
      const sword = new THREE.Group();
      sword.add(mesh(new THREE.BoxGeometry(0.09, 1.0, 0.04), metal, 0, 0.55, 0));
      sword.add(mesh(new THREE.BoxGeometry(0.3, 0.06, 0.08), glow, 0, 0.06, 0));
      sword.position.set(0.48, 0.75, 0.15);
      sword.rotation.x = 0.6;
      body.add(sword);
      parts.weapon = sword;
      break;
    }
    case 'assassin': {
      legs(dark, 0.18, 0.42, 0.15);
      body.add(mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.7, 5), dark, 0, 0.78, 0));
      body.add(mesh(new THREE.ConeGeometry(0.34, 0.65, 5), main, 0, 1.45, 0));
      body.add(mesh(new THREE.SphereGeometry(0.2, 6, 5), mat(0x0c0d14), 0, 1.33, 0.08));
      eyes(1.36, 0.25, 0.07, glow);
      body.add(mesh(new THREE.BoxGeometry(0.62, 0.1, 0.36), main, 0, 1.12, 0));
      for (const s of [-1, 1]) {
        const d = mesh(new THREE.ConeGeometry(0.06, 0.55, 4), glow, s * 0.38, 0.7, 0.25);
        d.rotation.x = Math.PI / 2 + 0.3;
        body.add(d);
      }
      body.rotation.x = 0.12;
      break;
    }
    case 'mage': {
      body.add(mesh(new THREE.ConeGeometry(0.55, 1.15, 7), main, 0, 0.58, 0));
      body.add(mesh(new THREE.IcosahedronGeometry(0.25, 0), skin, 0, 1.3, 0));
      eyes(1.32, 0.21);
      const hat = mesh(new THREE.ConeGeometry(0.34, 0.75, 7), dark, 0, 1.75, -0.03);
      hat.rotation.z = 0.18;
      body.add(hat);
      body.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), dark, 0, 1.43, 0));
      const orb = mesh(new THREE.IcosahedronGeometry(0.17, 1), glow, 0.55, 1.15, 0.3);
      body.add(orb);
      parts.orb = orb;
      break;
    }
    case 'ranger': {
      legs(dark, 0.2, 0.45, 0.17);
      body.add(mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.72, 6), dark, 0, 0.8, 0));
      const cloak = mesh(new THREE.ConeGeometry(0.42, 0.9, 6, 1, true), main, 0, 0.92, -0.05);
      body.add(cloak);
      body.add(mesh(new THREE.IcosahedronGeometry(0.24, 0), skin, 0, 1.38, 0));
      body.add(mesh(new THREE.ConeGeometry(0.3, 0.38, 6), main, 0, 1.62, -0.04));
      eyes(1.4, 0.2);
      const bow = new THREE.Group();
      bow.add(mesh(new THREE.TorusGeometry(0.55, 0.045, 4, 14, Math.PI), wood));
      bow.add(mesh(new THREE.BoxGeometry(1.1, 0.015, 0.015), mat(0xeeeeee)));
      bow.rotation.z = Math.PI / 2;
      bow.rotation.y = 0.3;
      bow.position.set(-0.42, 0.95, 0.25);
      body.add(bow);
      body.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.55, 6), wood, 0.2, 1.05, -0.3));
      break;
    }
    case 'support': {
      body.add(mesh(new THREE.CylinderGeometry(0.26, 0.5, 0.95, 8), mat(0xf4efe6), 0, 0.48, 0));
      body.add(mesh(new THREE.CylinderGeometry(0.27, 0.3, 0.25, 8), main, 0, 0.98, 0));
      body.add(mesh(new THREE.IcosahedronGeometry(0.25, 0), skin, 0, 1.3, 0));
      eyes(1.32, 0.21);
      const halo = mesh(new THREE.TorusGeometry(0.26, 0.04, 6, 18), glow, 0, 1.7, 0);
      halo.rotation.x = Math.PI / 2;
      body.add(halo);
      parts.halo = halo;
      body.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 5), wood, 0.48, 0.8, 0.1));
      const gem = mesh(new THREE.OctahedronGeometry(0.14, 0), glow, 0.48, 1.68, 0.1);
      body.add(gem);
      parts.orb = gem;
      break;
    }
  }
  g.userData.parts = parts;
  g.userData.body = body;
  g.userData.materials = [main, dark, skin, metal, wood, glow, eye];
  return g;
}

// ---------- Renderer ----------
export class Renderer {
  constructor(container, overlay) {
    this.container = container;
    this.overlay = overlay;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.prepend(this.renderer.domElement);

    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1020);
    scene.fog = new THREE.Fog(0x0d1020, 28, 60);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x2a2238, 1.1));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(5, 12, 7);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const sc = sun.shadow.camera;
    sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40;
    scene.add(sun);

    this.buildBoard();
    this.views = new Map();     // uid -> view
    this.projMeshes = new Map();
    this.fx = [];
    this.raycaster = new THREE.Raycaster();
    this.clock = 0;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(container);
    this.ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  buildBoard() {
    const scene = this.scene;
    const base = mesh(new THREE.CylinderGeometry(9.5, 10.5, 0.6, 8), mat(0x161a2e), 0, -0.4, 0);
    base.receiveShadow = true; base.castShadow = false;
    base.scale.z = 1.25;
    scene.add(base);
    const river = mesh(new THREE.BoxGeometry(8.6, 0.05, 0.9), mat(0x1d2a4a, { emissive: 0x1a2c5a, emissiveIntensity: 0.6 }), 0, -0.05, 0);
    river.receiveShadow = true;
    scene.add(river);

    this.hexes = [];
    const geo = new THREE.CylinderGeometry(R * 0.94, R * 0.94, 0.16, 6);
    const edgeGeo = new THREE.EdgesGeometry(geo);
    for (const side of ['player', 'enemy']) {
      for (const id of HEX_IDS) {
        const p = hexPos(side, id);
        const baseColor = side === 'player' ? 0x24345a : 0x46263a;
        const m = mat(baseColor, { emissive: 0x000000 });
        const h = new THREE.Mesh(geo, m);
        h.position.set(p.x, 0, p.z);
        h.receiveShadow = true;
        h.userData = { side, hex: id, baseColor };
        const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: side === 'player' ? 0x5a7bc4 : 0xa2547a, transparent: true, opacity: 0.6 }));
        h.add(edge);
        scene.add(h);
        this.hexes.push(h);
      }
    }
    // Decorative low-poly rocks and crystals around the arena.
    const rng = (i) => { const x = Math.sin(i * 91.7) * 43758.5; return x - Math.floor(x); };
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const rad = 9 + rng(i) * 2.5;
      const x = Math.cos(a) * rad * 0.85, z = Math.sin(a) * rad * 1.15;
      const crystal = i % 3 === 0;
      const geo2 = crystal ? new THREE.OctahedronGeometry(0.4 + rng(i + 3) * 0.5, 0) : new THREE.DodecahedronGeometry(0.5 + rng(i + 7) * 0.8, 0);
      const col = crystal ? [0xff6a3d, 0x6fd3ff, 0xb78cff][i % 3 === 0 ? (i / 3) % 3 : 0] : 0x2b3150;
      const m = crystal ? mat(col, { emissive: col, emissiveIntensity: 0.5 }) : mat(col);
      const o = mesh(geo2, m, x, crystal ? 0.4 : 0, z);
      if (crystal) o.scale.y = 2.2;
      o.rotation.set(rng(i + 1), rng(i + 2) * 3, rng(i + 4));
      scene.add(o);
    }
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h || (w === this._w && h === this._h)) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.fitCamera();
  }

  fitCamera() {
    const cam = this.camera;
    const elev = THREE.MathUtils.degToRad(56);
    const target = new THREE.Vector3(0, 0, 0.5);
    const zMax = GAP + 3 * R + R;
    const pts = [];
    for (const x of [-3.9, 3.9]) for (const z of [-zMax, zMax]) for (const y of [0, 2.2]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 5, hi = 80;
    for (let i = 0; i < 30; i++) {
      const d = (lo + hi) / 2;
      cam.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d).add(target);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      const ok = pts.every(p => { const v = p.clone().project(cam); return Math.abs(v.x) < 0.96 && Math.abs(v.y) < 0.94; });
      if (ok) hi = d; else lo = d;
    }
    const d = hi;
    cam.position.set(0, Math.sin(elev) * d, Math.cos(elev) * d).add(target);
    cam.lookAt(target);
    cam.updateProjectionMatrix();
  }

  // ---------- Units ----------
  ensureView(u) {
    let v = this.views.get(u.uid);
    if (v && (v.id !== u.id || v.star !== u.star)) { this.removeView(u.uid); v = null; }
    if (v) return v;
    const group = new THREE.Group();
    const model = buildModel(u.id);
    const s = [0, 0.78, 0.9, 1.02][u.star];
    model.scale.setScalar(s);
    group.add(model);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 4, 24), new THREE.MeshBasicMaterial({ color: TEAM_COLOR[u.side] }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.1;
    group.add(ring);
    if (u.star >= 2) {
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.035, 4, 24), new THREE.MeshBasicMaterial({ color: u.star === 3 ? 0xffd34d : 0xd9e2f2 }));
      ring2.rotation.x = Math.PI / 2; ring2.position.y = 0.1;
      group.add(ring2);
    }
    group.position.set(u.x, 0.08, u.z);
    group.rotation.y = u.side === 'player' ? Math.PI : 0;
    this.scene.add(group);

    const bar = document.createElement('div');
    bar.className = `ubar ${u.side}`;
    bar.innerHTML = `<div class="stars s${u.star}">${'★'.repeat(u.star)}</div><div class="hpb"><i class="hp"></i><i class="sh"></i></div><div class="mpb"><i class="mp"></i></div>`;
    this.overlay.appendChild(bar);

    v = {
      uid: u.uid, id: u.id, star: u.star, side: u.side, group, model, bar,
      hpEl: bar.querySelector('.hp'), shEl: bar.querySelector('.sh'), mpEl: bar.querySelector('.mp'),
      x: u.x, z: u.z, tx: u.x, tz: u.z, facing: group.rotation.y, lunge: 0, flash: 0, jump: 0, dead: 0, alive: true,
      hex: u.hex, scale: s,
    };
    model.traverse(o => { if (o.isMesh) o.userData.uid = u.uid; });
    this.views.set(u.uid, v);
    return v;
  }

  removeView(uid) {
    const v = this.views.get(uid);
    if (!v) return;
    this.scene.remove(v.group);
    v.bar.remove();
    this.views.delete(uid);
  }

  // Planning: list of {uid,id,star,side,hex}
  syncPlanning(list) {
    const keep = new Set(list.map(u => u.uid));
    for (const uid of [...this.views.keys()]) if (!keep.has(uid)) this.removeView(uid);
    for (const u of list) {
      const p = hexPos(u.side, u.hex);
      const v = this.ensureView({ ...u, ...p });
      v.hex = u.hex; v.tx = p.x; v.tz = p.z; v.alive = true; v.dead = 0;
      v.group.visible = true; v.group.scale.setScalar(1);
      v.facingTarget = u.side === 'player' ? Math.PI : 0;
      v.bar.style.display = '';
      v.combat = null;
    }
    this.battle = null;
    for (const m of this.projMeshes.values()) this.scene.remove(m);
    this.projMeshes.clear();
  }

  startBattle(battle) {
    this.battle = battle;
    for (const f of battle.units) {
      const v = this.views.get(f.uid);
      if (v) v.combat = f;
    }
  }

  onEvent(e) {
    const v = this.views.get(e.uid);
    switch (e.type) {
      case 'attack': if (v) v.lunge = v.combat && v.combat.melee ? 0.2 : 0.12; break;
      case 'dmg':
        if (v) { v.flash = 0.12; this.floatText(v, e.amount, e.crit ? 'crit' : e.kind); }
        break;
      case 'heal': if (v) this.floatText(v, '+' + e.amount, 'heal'); break;
      case 'shield': if (v) this.floatText(v, '◈' + e.amount, 'shield'); break;
      case 'leap': if (v) { v.jump = 0.45; v.x = v.combat.x; v.z = v.combat.z; } break;
      case 'cast': if (v) this.floatText(v, e.name, 'cast'); break;
      case 'death': if (v) { v.alive = false; v.dead = 0.6; } break;
      case 'fx': this.spawnFx(e); break;
    }
  }

  floatText(v, text, cls) {
    const el = document.createElement('div');
    el.className = `ftxt ${cls}`;
    el.textContent = text;
    const p = this.toScreen(v.group.position.x, 1.9, v.group.position.z);
    el.style.left = (p.x + (Math.random() - 0.5) * 24) + 'px';
    el.style.top = p.y + 'px';
    this.overlay.appendChild(el);
    setTimeout(() => el.remove(), 900);
  }

  spawnFx(e) {
    let m;
    if (e.kind === 'ring') {
      m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32), new THREE.MeshBasicMaterial({ color: e.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(e.x, 0.15, e.z);
      m.userData = { life: 0.5, max: 0.5, grow: e.r };
    } else if (e.kind === 'burst') {
      const v = this.views.get(e.uid);
      if (!v) return;
      m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshBasicMaterial({ color: e.color, transparent: true, opacity: 0.85, wireframe: true }));
      m.position.set(v.group.position.x, 0.9, v.group.position.z);
      m.userData = { life: 0.4, max: 0.4, grow: 1.6 };
    } else if (e.kind === 'beam') {
      const a = this.views.get(e.from), b = this.views.get(e.to);
      if (!a || !b) return;
      const p1 = a.group.position.clone().setY(1.0), p2 = b.group.position.clone().setY(0.9);
      const len = p1.distanceTo(p2);
      m = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, len, 5), new THREE.MeshBasicMaterial({ color: e.color, transparent: true, opacity: 0.9 }));
      m.position.copy(p1).lerp(p2, 0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p2.clone().sub(p1).normalize());
      m.userData = { life: 0.25, max: 0.25 };
    }
    if (m) { this.scene.add(m); this.fx.push(m); }
  }

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this._w, y: (-v.y * 0.5 + 0.5) * this._h };
  }

  // Returns {side, hex} under a client point, or null.
  pick(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const unitMeshes = [];
    for (const v of this.views.values()) if (v.group.visible) v.model.traverse(o => { if (o.isMesh) unitMeshes.push(o); });
    const hitU = this.raycaster.intersectObjects(unitMeshes, false)[0];
    if (hitU) {
      const v = this.views.get(hitU.object.userData.uid);
      if (v && v.hex) return { side: v.side, hex: v.hex, uid: v.uid };
    }
    const hitH = this.raycaster.intersectObjects(this.hexes, false)[0];
    if (hitH) return { side: hitH.object.userData.side, hex: hitH.object.userData.hex };
    // Forgiving touch: snap to the nearest hex if the finger lands just outside one.
    const pt = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.ground, pt)) {
      let best = null, bd = R * 1.25;
      for (const h of this.hexes) {
        const d = Math.hypot(h.position.x - pt.x, h.position.z - pt.z);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) return { side: best.userData.side, hex: best.userData.hex };
    }
    return null;
  }

  // highlights: Map key `${side}|${hex}` -> 'valid'|'hover'|'selected'
  setHighlights(map) {
    for (const h of this.hexes) {
      const mode = map && map.get(`${h.userData.side}|${h.userData.hex}`);
      const m = h.material;
      if (mode === 'hover') { m.emissive.setHex(0x4fe0b0); m.emissiveIntensity = 0.55; }
      else if (mode === 'selected') { m.emissive.setHex(0xffd34d); m.emissiveIntensity = 0.45; }
      else if (mode === 'valid') { m.emissive.setHex(0x3a6bd8); m.emissiveIntensity = 0.3; }
      else { m.emissive.setHex(0x000000); m.emissiveIntensity = 0; }
    }
  }

  update(dt) {
    this.clock += dt;
    const t = this.clock;
    for (const v of this.views.values()) {
      const f = v.combat;
      if (f) { v.tx = f.x; v.tz = f.z; v.facingTarget = f.facing; }
      const k = 1 - Math.exp(-dt * 14);
      v.x += (v.tx - v.x) * k;
      v.z += (v.tz - v.z) * k;
      // facing
      if (v.facingTarget !== undefined) {
        let d = v.facingTarget - v.facing;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        v.facing += d * Math.min(1, dt * 10);
      }
      let lx = 0, lz = 0, y = 0.08;
      if (v.lunge > 0) {
        const p = Math.sin((v.lunge / 0.2) * Math.PI) * 0.35;
        lx = Math.sin(v.facing) * p; lz = Math.cos(v.facing) * p;
        v.lunge -= dt;
      }
      if (v.jump > 0) { y += Math.sin((v.jump / 0.45) * Math.PI) * 1.6; v.jump -= dt; }
      v.group.position.set(v.x + lx, y, v.z + lz);
      v.group.rotation.y = v.facing;
      const body = v.model.userData.body;
      body.position.y = Math.sin(t * 3 + v.uid) * 0.035 + (f && f.moving ? Math.abs(Math.sin(t * 12 + v.uid)) * 0.08 : 0);
      const parts = v.model.userData.parts;
      if (parts.orb) { parts.orb.rotation.y += dt * 2; parts.orb.position.y += Math.sin(t * 2.5 + v.uid) * 0.002; }
      if (parts.halo) parts.halo.rotation.z += dt;

      // hit flash
      const mats = v.model.userData.materials;
      if (v.flash > 0) {
        v.flash -= dt;
        for (const m of mats) { if (!m.userData.base) m.userData.base = { e: m.emissive.getHex(), i: m.emissiveIntensity }; m.emissive.setHex(0xffffff); m.emissiveIntensity = 0.6; }
        if (v.flash <= 0) for (const m of mats) { const b = m.userData.base; m.emissive.setHex(b.e); m.emissiveIntensity = b.i; }
      }
      // stun / death
      if (!v.alive) {
        v.dead -= dt;
        const s = Math.max(0, v.dead / 0.6);
        v.group.scale.setScalar(s);
        v.group.position.y -= (1 - s) * 0.3;
        if (v.dead <= 0) v.group.visible = false;
        v.bar.style.display = 'none';
        continue;
      }
      // bars
      const sp = this.toScreen(v.group.position.x, 2.05 * v.scale + 0.25, v.group.position.z);
      v.bar.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
      if (f) {
        const tot = Math.max(f.maxHp, f.hp + f.shield);
        v.hpEl.style.width = (f.hp / tot * 100) + '%';
        v.shEl.style.width = (f.shield / tot * 100) + '%';
        v.shEl.style.left = (f.hp / tot * 100) + '%';
        v.mpEl.style.width = (f.mana / f.maxMana * 100) + '%';
        v.bar.classList.toggle('stunned', f.stunT > 0);
      } else {
        v.hpEl.style.width = '100%'; v.shEl.style.width = '0%'; v.mpEl.style.width = '0%';
        v.bar.classList.remove('stunned');
      }
    }

    // projectiles
    if (this.battle) {
      const live = new Set();
      for (const p of this.battle.projectiles) {
        live.add(p.id);
        let m = this.projMeshes.get(p.id);
        if (!m) {
          const color = ORIGINS[p.src.origin].color;
          if (p.kind === 'ranger') {
            m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            m.rotation.x = Math.PI / 2;
            const holder = new THREE.Group(); holder.add(m); m = holder;
          } else {
            m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), new THREE.MeshBasicMaterial({ color }));
          }
          this.scene.add(m);
          this.projMeshes.set(p.id, m);
        }
        m.position.set(p.x, 1.0, p.z);
        m.lookAt(p.tgt.x, 1.0, p.tgt.z);
      }
      for (const [id, m] of this.projMeshes) if (!live.has(id)) { this.scene.remove(m); this.projMeshes.delete(id); }
    }

    // fx
    this.fx = this.fx.filter(m => {
      m.userData.life -= dt;
      const a = Math.max(0, m.userData.life / m.userData.max);
      m.material.opacity = a * 0.85;
      if (m.userData.grow) m.scale.setScalar(0.3 + (1 - a) * m.userData.grow);
      if (m.userData.life <= 0) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); return false; }
      return true;
    });

    this.renderer.render(this.scene, this.camera);
  }
}

// ---------- Portrait thumbnails for shop / bench ----------
let thumbR = null;
const thumbCache = new Map();
export function thumbnail(champId) {
  if (thumbCache.has(champId)) return thumbCache.get(champId);
  if (!thumbR) {
    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.setSize(160, 160);
    r.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xdde8ff, 0x403050, 1.4));
    const d = new THREE.DirectionalLight(0xffffff, 2.2); d.position.set(2, 4, 5); scene.add(d);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    cam.position.set(1.6, 2.0, 4.2); cam.lookAt(0, 1.0, 0);
    thumbR = { r, scene, cam };
  }
  const { r, scene, cam } = thumbR;
  const m = buildModel(champId);
  m.rotation.y = 0.35;
  scene.add(m);
  r.render(scene, cam);
  const url = r.domElement.toDataURL('image/png');
  scene.remove(m);
  thumbCache.set(champId, url);
  return url;
}
