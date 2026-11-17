// Board geometry. Each side has a 4-3-4 hex layout (front, middle, back).
export const R = 1;                 // hex circumradius
export const W = Math.sqrt(3) * R;  // hex width (flat-to-flat)
export const ROWS = [4, 3, 4];      // row 0 = front line
export const GAP = 1.5 * R;         // front rows sit one hex-row from the neutral middle row

export function hexId(row, col) { return `${row}:${col}`; }
export function parseHex(id) { const [r, c] = id.split(':').map(Number); return { row: r, col: c }; }

export const HEX_IDS = [];
ROWS.forEach((n, r) => { for (let c = 0; c < n; c++) HEX_IDS.push(hexId(r, c)); });

// side: 'player' (z > 0, near camera) or 'enemy' (z < 0)
export function hexPos(side, id) {
  const { row, col } = parseHex(id);
  const n = ROWS[row];
  const x = (col - (n - 1) / 2) * W;
  const z = (GAP + row * 1.5 * R) * (side === 'player' ? 1 : -1);
  return { x, z };
}

export function rangeToWorld(hexes) { return hexes * W * 0.98 + 0.25; }

// ---------- Combat graph: 22 hex nodes (both sides), adjacency and hop distances ----------
export const NODES = [];
for (const side of ['player', 'enemy']) for (const id of HEX_IDS) {
  const p = hexPos(side, id);
  NODES.push({ i: NODES.length, side, hex: id, x: p.x, z: p.z, row: parseHex(id).row });
}
// Neutral grey middle row (3 hexes) that both teams walk across.
export const MID_HEXES = [-1, 0, 1].map(k => ({ x: k * W, z: 0 }));
MID_HEXES.forEach((p, k) => NODES.push({ i: NODES.length, side: 'neutral', hex: `n:${k}`, x: p.x, z: p.z, row: -1 }));
export const NODE_INDEX = (side, hex) => NODES.findIndex(n => n.side === side && n.hex === hex);
export const ADJ = NODES.map(a => NODES.filter(b => a !== b && Math.hypot(a.x - b.x, a.z - b.z) <= W * 1.05).map(b => b.i));
export const HOPS = NODES.map(a => {
  const dist = NODES.map(() => Infinity);
  dist[a.i] = 0;
  const q = [a.i];
  while (q.length) { const c = q.shift(); for (const n of ADJ[c]) if (dist[n] === Infinity) { dist[n] = dist[c] + 1; q.push(n); } }
  return dist;
});
