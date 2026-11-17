# Fourfold (working title)

A light, single-player TFT-style auto-battler for mobile web. Built with Three.js and plain ES modules. No build step.

**Play:** https://jbaxmeyer-personal.github.io/fourfold/

## Core rules
- **4 champions max** on a 4-3-4 hex board (front / middle / back).
- **6 classes:** Tank, Fighter, Assassin, Mage, Ranger, Support. Class traits trigger at 2 and 3 champions.
- **3 origins:** Ember, Frost, Storm. Origin traits trigger at 2, 3 and 4 champions.
- 18 champions, one for each class/origin pair, costing 1 to 3 gold.
- TFT-style shop with rerolls, a lock, and a 6-slot bench. 3 copies merge into ★★, and 3 ★★ merge into ★★★.
- **Gauntlet:** 12 escalating fights (elites at 4 and 8, boss at 12). A loss costs HP. Reach 0 HP and the run ends.
- Combat is fully automatic. Positioning is the only input.

## Code
| File | Purpose |
|---|---|
| `js/data.js` | Champions, traits, stats, encounters, economy constants |
| `js/game.js` | Run state: shop, bench/board, merges, traits, enemy generation, save/load |
| `js/combat.js` | Auto-battle simulation and abilities (no rendering) |
| `js/render.js` | Three.js scene, low-poly champion models, combat visuals |
| `js/main.js` | UI, drag and drop, game loop |

Run locally: `python3 -m http.server`, then open `localhost:8000`.
