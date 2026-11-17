// Board geometry. Each side has a 4-3-4 hex layout (front, middle, back).
export const R = 1;                 // hex circumradius
export const W = Math.sqrt(3) * R;  // hex width (flat-to-flat)
export const ROWS = [4, 3, 4];      // row 0 = front line
export const GAP = 1.35;            // distance from centre line to front row

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
