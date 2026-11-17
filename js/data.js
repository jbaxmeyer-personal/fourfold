// Static game data: classes, origins, champions, encounters.

export const CLASSES = {
  tank: {
    name: 'Tank', icon: '🛡️', role: 'Frontline',
    thresholds: [2, 3],
    desc: 'Tanks gain bonus max HP.',
    tiers: ['+300 HP', '+650 HP'],
    values: [300, 650],
  },
  fighter: {
    name: 'Fighter', icon: '⚔️', role: 'Frontline',
    thresholds: [2, 3],
    desc: 'Innate: hunt down enemy assassins that dive your backline, but weak to magic. Bonus: heal for a % of all damage dealt.',
    tiers: ['20% lifesteal', '40% lifesteal'],
    values: [0.2, 0.4],
  },
  assassin: {
    name: 'Assassin', icon: '🗡️', role: 'Diver',
    thresholds: [2, 3],
    desc: 'Innate: sprint past the frontline and hunt enemy Mages, Rangers and Supports until they are all dead. Bonus: crit chance and crit damage.',
    tiers: ['+20% crit, +30% crit dmg', '+45% crit, +60% crit dmg'],
    values: [[0.2, 0.3], [0.45, 0.6]],
  },
  mage: {
    name: 'Mage', icon: '🔮', role: 'Backline',
    thresholds: [2, 3],
    desc: 'Innate: abilities deal +25% damage to Fighters. Bonus: mage abilities deal bonus damage.',
    tiers: ['+30% ability dmg', '+70% ability dmg'],
    values: [0.3, 0.7],
  },
  ranger: {
    name: 'Ranger', icon: '🏹', role: 'Backline',
    thresholds: [2, 3],
    desc: 'Rangers gain bonus attack speed.',
    tiers: ['+30% attack speed', '+70% attack speed'],
    values: [0.3, 0.7],
  },
  support: {
    name: 'Support', icon: '✨', role: 'Backline',
    thresholds: [2, 3],
    desc: 'Your whole team starts combat with a shield.',
    tiers: ['120 HP shield', '280 HP shield'],
    values: [120, 280],
  },
};

export const ORIGINS = {
  ember: {
    name: 'Ember', icon: '🔥', color: 0xff6a3d, css: '#ff6a3d',
    thresholds: [2, 3, 4],
    desc: 'Ember champions deal bonus damage.',
    tiers: ['+15% damage', '+30% damage', '+50% damage'],
    values: [0.15, 0.3, 0.5],
  },
  frost: {
    name: 'Frost', icon: '❄️', color: 0x6fd3ff, css: '#6fd3ff',
    thresholds: [2, 3, 4],
    desc: 'All enemies are Chilled, reducing their attack speed.',
    tiers: ['-15% enemy AS', '-25% enemy AS', '-40% enemy AS'],
    values: [0.15, 0.25, 0.4],
  },
  storm: {
    name: 'Storm', icon: '⚡', color: 0xb78cff, css: '#b78cff',
    thresholds: [2, 3, 4],
    desc: 'Storm champions start combat with bonus mana.',
    tiers: ['40% starting mana', '70% starting mana', '100% starting mana'],
    values: [0.4, 0.7, 1.0],
  },
};

// Base 1-star stats by class. range is in hexes.
export const CLASS_STATS = {
  tank:     { hp: 900, ad: 50, as: 0.60, range: 1, armor: 45, mr: 45, mana: 80, startMana: 20, crit: 0 },
  fighter:  { hp: 760, ad: 62, as: 0.72, range: 1, armor: 30, mr: 10, mana: 70, startMana: 0,  crit: 0 },
  assassin: { hp: 560, ad: 68, as: 0.85, range: 1, armor: 20, mr: 20, mana: 60, startMana: 10, crit: 0.25 },
  mage:     { hp: 520, ad: 40, as: 0.65, range: 2, armor: 15, mr: 30, mana: 70, startMana: 20, crit: 0 },
  ranger:   { hp: 540, ad: 58, as: 0.78, range: 3, armor: 15, mr: 15, mana: 80, startMana: 0,  crit: 0 },
  support:  { hp: 580, ad: 35, as: 0.65, range: 2, armor: 20, mr: 30, mana: 60, startMana: 20, crit: 0 },
};

export const STAR_MULT = [0, 1, 1.8, 3.24];   // hp / ad
export const ABILITY_MULT = [0, 1, 1.6, 2.6]; // flat ability values

// 18 champions: every class x origin pair once. Each origin has two of each cost.
export const CHAMPS = [
  // Tanks
  { id: 'kiln', name: 'Kiln', cls: 'tank', origin: 'ember', cost: 1,
    ability: 'Molten Guard', desc: 'Gains a 250 shield and taunts nearby enemies for 2.5s.' },
  { id: 'hoarfrost', name: 'Hoarfrost', cls: 'tank', origin: 'frost', cost: 2,
    ability: 'Glacial Slam', desc: 'Slams the ground, dealing 90 magic damage and stunning nearby enemies for 1.5s.' },
  { id: 'bulwark', name: 'Bulwark', cls: 'tank', origin: 'storm', cost: 3,
    ability: 'Static Fortress', desc: 'Shields nearby allies for 180 and taunts nearby enemies for 2s.' },
  // Fighters
  { id: 'icefang', name: 'Icefang', cls: 'fighter', origin: 'frost', cost: 1,
    ability: 'Frostbite', desc: 'Strikes for 240% AD and Chills the target (-40% AS) for 3s.' },
  { id: 'gale', name: 'Gale', cls: 'fighter', origin: 'storm', cost: 2,
    ability: 'Cyclone', desc: 'Spins, dealing 160% AD to all adjacent enemies.' },
  { id: 'pyre', name: 'Pyre', cls: 'fighter', origin: 'ember', cost: 3,
    ability: 'Inferno Cleave', desc: 'Cleaves the target for 320% AD and heals for 40% of the damage.' },
  // Assassins
  { id: 'flicker', name: 'Flicker', cls: 'assassin', origin: 'storm', cost: 1,
    ability: 'Shadow Strike', desc: 'Strikes for 250% AD. Refunds half its mana on a kill.' },
  { id: 'ashblade', name: 'Ashblade', cls: 'assassin', origin: 'ember', cost: 2,
    ability: 'Execute', desc: 'Strikes for 300% AD. Double damage against targets below 40% HP.' },
  { id: 'shiver', name: 'Shiver', cls: 'assassin', origin: 'frost', cost: 3,
    ability: 'Shatter', desc: 'A guaranteed critical strike for 400% AD that stuns for 1s.' },
  // Mages
  { id: 'cinder', name: 'Cinder', cls: 'mage', origin: 'ember', cost: 1,
    ability: 'Fireball', desc: 'Hurls a fireball for 260 magic damage; half damage splashes nearby.' },
  { id: 'frostweaver', name: 'Frostweaver', cls: 'mage', origin: 'frost', cost: 2,
    ability: 'Blizzard', desc: 'Deals 170 magic damage around the target and stuns for 1s.' },
  { id: 'tempest', name: 'Tempest', cls: 'mage', origin: 'storm', cost: 3,
    ability: 'Chain Lightning', desc: 'Lightning hits 4 enemies for 240 magic damage each.' },
  // Rangers
  { id: 'sleet', name: 'Sleet', cls: 'ranger', origin: 'frost', cost: 1,
    ability: 'Ice Arrow', desc: 'Fires an arrow for 260% AD that Chills the target for 3s.' },
  { id: 'bolt', name: 'Bolt', cls: 'ranger', origin: 'storm', cost: 2,
    ability: 'Overcharge', desc: 'Gains +90% attack speed for 4s.' },
  { id: 'flare', name: 'Flare', cls: 'ranger', origin: 'ember', cost: 3,
    ability: 'Barrage', desc: 'Fires 5 arrows at random enemies for 130% AD each.' },
  // Supports
  { id: 'spark', name: 'Spark', cls: 'support', origin: 'storm', cost: 1,
    ability: 'Jolt Ward', desc: 'Shields the weakest ally for 220 and gives them 20 mana.' },
  { id: 'hearth', name: 'Hearth', cls: 'support', origin: 'ember', cost: 2,
    ability: 'Warmth', desc: 'Heals all allies for 130.' },
  { id: 'aurora', name: 'Aurora', cls: 'support', origin: 'frost', cost: 3,
    ability: 'Dawnlight', desc: 'Heals all allies for 110 and shields them for 110.' },
];

export const CHAMP_BY_ID = Object.fromEntries(CHAMPS.map(c => [c.id, c]));

// Shop odds [cost1, cost2, cost3] by fight number.
export function shopOdds(fight) {
  if (fight <= 3) return [0.8, 0.2, 0];
  if (fight <= 6) return [0.55, 0.35, 0.1];
  if (fight <= 9) return [0.35, 0.4, 0.25];
  return [0.2, 0.4, 0.4];
}

export const TOTAL_FIGHTS = 12;
export const LIVES = 3;
export const START_GOLD = 10;
export const REROLL_COST = 2;
export const BENCH_SIZE = 6;
export const MAX_BOARD = 4;

// Gauntlet: stars for each enemy unit and a stat multiplier.
export const ENCOUNTERS = [
  { type: 'normal', stars: [1, 1], mult: 1.0 },
  { type: 'normal', stars: [1, 1, 1], mult: 0.9 },
  { type: 'normal', stars: [1, 1, 1], mult: 1.0 },
  { type: 'elite',  stars: [2, 2, 1], mult: 1.0 },
  { type: 'normal', stars: [2, 1, 1, 1], mult: 1.0 },
  { type: 'normal', stars: [2, 1, 1, 1], mult: 1.05 },
  { type: 'normal', stars: [2, 2, 1, 1], mult: 1.0 },
  { type: 'elite',  stars: [2, 2, 1, 1], mult: 1.1 },
  { type: 'normal', stars: [2, 2, 2, 1], mult: 1.0 },
  { type: 'normal', stars: [2, 2, 2, 1], mult: 1.08 },
  { type: 'normal', stars: [2, 2, 2, 2], mult: 1.0 },
  { type: 'boss',   stars: [3, 2, 2, 2], mult: 1.05 },
];

export const ENCOUNTER_NAMES = {
  ember: ['Ember Raiders', 'Ash Pack', 'Cinder Cult', 'Kindled Host'],
  frost: ['Frost Wardens', 'Rime Hunters', 'Glacier Watch', 'Hollow Snow'],
  storm: ['Storm Callers', 'Static Swarm', 'Thunder Choir', 'Gale Riders'],
};
export const BOSS_NAMES = { ember: 'The Ashen King', frost: 'The Winter Court', storm: 'The Tempest Throne' };

// Encounter archetypes so runs don't repeat: class weights for enemy picks.
export const ARCHETYPES = {
  balanced:  { name: null, w: { tank: 2, fighter: 2, assassin: 1, mage: 2, ranger: 2, support: 1 } },
  dive:      { name: 'Divers', w: { assassin: 5, fighter: 2, tank: 1, mage: 1, ranger: 1, support: 1 } },
  wall:      { name: 'Wall', w: { tank: 4, fighter: 3, support: 2, mage: 1, ranger: 1, assassin: 0.5 } },
  artillery: { name: 'Artillery', w: { mage: 4, ranger: 4, tank: 2, support: 1, fighter: 0.5, assassin: 0.5 } },
  brawl:     { name: 'Brawlers', w: { fighter: 5, tank: 2, assassin: 2, support: 1, mage: 0.5, ranger: 0.5 } },
};

// Permanent run buffs offered as rewards. apply(fighter, stacks)
export const BUFFS = {
  vitality: { name: 'Vitality', icon: '❤️', desc: '+8% max HP for your team', apply: (f, n) => { const b = Math.round(f.maxHp * 0.08 * n); f.maxHp += b; f.hp += b; } },
  might:    { name: 'Might', icon: '💪', desc: '+8% damage for your team', apply: (f, n) => { f.dmgAmp += 0.08 * n; } },
  haste:    { name: 'Haste', icon: '💨', desc: '+10% attack speed for your team', apply: (f, n) => { f.asBonus += 0.1 * n; } },
  bulwark:  { name: 'Ironskin', icon: '🪨', desc: '+12 armor and MR for your team', apply: (f, n) => { f.armor += 12 * n; f.mr += 12 * n; } },
  focus:    { name: 'Focus', icon: '🔷', desc: '+15 starting mana for your team', apply: (f, n) => { f.mana = Math.min(f.maxMana, f.mana + 15 * n); } },
};
