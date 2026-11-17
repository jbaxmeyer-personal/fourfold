# Fourfold (working title)

A light, single-player TFT-style auto-battler for mobile web. Built with Three.js and plain ES modules. No build step.

**Play:** https://jbaxmeyer-personal.github.io/fourfold/

## Core rules
- **4 champions max** on a 4-3-4 hex board (front / middle / back).
- **6 classes:** Tank, Fighter, Assassin, Mage, Ranger, Support. Class traits trigger at 2 and 3 champions.
- **3 origins:** Ember, Frost, Storm. Origin traits trigger at 2, 3 and 4 champions.
- 18 champions, one for each class/origin pair, costing 1 to 3 gold.
- TFT-style shop with rerolls, a lock, and a 6-slot bench. 3 copies merge into ★★, and 3 ★★ merge into ★★★. ★★★ champions leave the shop.
- One copy of each champion on the board.
- **Gauntlet:** 12 escalating fights (elites at 4 and 8, boss at 12). Every run gets a new mix of enemy themes, archetypes and placements.
- **3 lives:** lose three fights and the run ends. A lost boss fight is replayed while you still have lives.
- **Rewards:** after each win, pick one: a free champion, gold, or a permanent team buff.
- **Counters:** Assassins dive the backline. Fighters peel assassins. Mages deal +25% ability damage to Fighters, who have low MR.
- Combat is fully automatic on the hex grid. Units step hex to hex and can body-block, so positioning matters.

## Art
Characters and animations come from [KayKit Adventurers](https://kaylousberg.com) by Kay Lousberg (CC0). Animations live in one shared `assets/models/anims.glb` and are bound to every character by bone name.

## Code
| File | Purpose |
|---|---|
| `js/data.js` | Champions, traits, stats, encounters, economy constants |
| `js/game.js` | Run state: shop, bench/board, merges, traits, enemy generation, save/load |
| `js/combat.js` | Auto-battle simulation and abilities (no rendering) |
| `js/models.js` | Loads the KayKit characters; per-champion props, origin tints, animation state |
| `js/render.js` | Three.js scene, board, combat VFX, health bars |
| `js/main.js` | UI, drag and drop, game loop |

Run locally: `python3 -m http.server`, then open `localhost:8000`.
