'use strict';
/**
 * Decorum Scenario Generator Engine
 * Port of prototype/main.py to JavaScript.
 *
 * Generates complete Decorum scenarios:
 *   1. Solution (final) board state
 *   2. Per-player constraint rules (all satisfied by solution)
 *   3. Initial board via backward-walk perturbation
 *   4. Natural-language rendering of constraints
 */

// ================================================================
// SECTION 1: CONSTANTS
// ================================================================

const COLORS = ['Red', 'Yellow', 'Blue', 'Green'];
const WARM_COLORS = new Set(['Red', 'Yellow']);
const COOL_COLORS = new Set(['Blue', 'Green']);
const STYLES = ['Modern', 'Antique', 'Retro', 'Unusual'];
const OBJECT_TYPES = ['Lamp', 'Wall Hanging', 'Curio'];
const OBJ_PLURAL = { 'Lamp': 'lamps', 'Wall Hanging': 'wall hangings', 'Curio': 'curios' };
const SLOT_KEY = { 'Lamp': 'lamp', 'Wall Hanging': 'wallHanging', 'Curio': 'curio' };

const STYLE_TO_COLOR = {
  'Lamp':         { Modern: 'Blue', Antique: 'Yellow', Retro: 'Red', Unusual: 'Green' },
  'Wall Hanging': { Modern: 'Red',  Antique: 'Green',  Retro: 'Blue', Unusual: 'Yellow' },
  'Curio':        { Modern: 'Green', Antique: 'Blue',  Retro: 'Yellow', Unusual: 'Red' },
};
const COLOR_TO_STYLE = {};
for (const [ot, map] of Object.entries(STYLE_TO_COLOR)) {
  COLOR_TO_STYLE[ot] = {};
  for (const [st, col] of Object.entries(map)) COLOR_TO_STYLE[ot][col] = st;
}

const ROOMS_2P = ['Bathroom', 'Bedroom', 'Living Room', 'Kitchen'];
const ROOMS_34P = ['Bedroom A', 'Bedroom B', 'Living Room', 'Kitchen'];

const LAYOUT_2P = {
  upstairs: ['Bathroom', 'Bedroom'], downstairs: ['Living Room', 'Kitchen'],
  'left side': ['Bathroom', 'Living Room'], 'right side': ['Bedroom', 'Kitchen'],
};
const LAYOUT_34P = {
  upstairs: ['Bedroom A', 'Bedroom B'], downstairs: ['Living Room', 'Kitchen'],
  'left side': ['Bedroom A', 'Living Room'], 'right side': ['Bedroom B', 'Kitchen'],
};
const AREA_NAMES = ['upstairs', 'downstairs', 'left side', 'right side'];
const VERTICAL_AREAS = ['upstairs', 'downstairs'];

// Room positions in the 2×2 grid: [row, col]
const ROOM_POS_2P = {
  'Bathroom': [0, 0], 'Bedroom': [0, 1],
  'Living Room': [1, 0], 'Kitchen': [1, 1],
};
const ROOM_POS_34P = {
  'Bedroom A': [0, 0], 'Bedroom B': [0, 1],
  'Living Room': [1, 0], 'Kitchen': [1, 1],
};
function getRoomPositions(np) { return np === 2 ? ROOM_POS_2P : ROOM_POS_34P; }
function getRoomAt(row, col, np) {
  for (const [name, p] of Object.entries(getRoomPositions(np)))
    if (p[0] === row && p[1] === col) return name;
  return null;
}
function getRoomAbove(rn, np)   { const p = getRoomPositions(np)[rn]; return p && p[0] > 0 ? getRoomAt(p[0] - 1, p[1], np) : null; }
function getRoomBelow(rn, np)   { const p = getRoomPositions(np)[rn]; return p && p[0] < 1 ? getRoomAt(p[0] + 1, p[1], np) : null; }
function getRoomBeside(rn, np)  { const p = getRoomPositions(np)[rn]; return p ? getRoomAt(p[0], p[1] === 0 ? 1 : 0, np) : null; }
function getRoomDiagonal(rn, np){ const p = getRoomPositions(np)[rn]; return p ? getRoomAt(p[0] === 0 ? 1 : 0, p[1] === 0 ? 1 : 0, np) : null; }
function getAdjacentRooms(rn, np) { return [getRoomAbove(rn, np), getRoomBelow(rn, np), getRoomBeside(rn, np)].filter(Boolean); }
function getAdjacentPairs(np) {
  const rooms = np === 2 ? ROOMS_2P : ROOMS_34P;
  const pairs = [], seen = new Set();
  for (const rn of rooms) for (const a of getAdjacentRooms(rn, np)) {
    const k = [rn, a].sort().join('|');
    if (!seen.has(k)) { seen.add(k); pairs.push([rn, a]); }
  }
  return pairs;
}
function getDiagonalPairs(np) {
  const rooms = np === 2 ? ROOMS_2P : ROOMS_34P;
  const pairs = [], seen = new Set();
  for (const rn of rooms) {
    const d = getRoomDiagonal(rn, np);
    if (d) { const k = [rn, d].sort().join('|'); if (!seen.has(k)) { seen.add(k); pairs.push([rn, d]); } }
  }
  return pairs;
}

const DIFFICULTY_PARAMS = {
  easy:   { numColors: 3, numStyles: 3, totalItems: [5, 7], patternProb: 0.35,
            rulesPerPlayer: 3, pertRange: [3, 5], warmCoolBias: 1.5,
            pertWeights: { paint: 1.0, swap: 1.5, remove: 0.5, add: 0.3 } },
  medium: { numColors: 3, numStyles: 4, totalItems: [6, 9], patternProb: 0.30,
            rulesPerPlayer: 4, pertRange: [5, 8], warmCoolBias: 1.5,
            pertWeights: { paint: 1.0, swap: 1.5, remove: 0.8, add: 0.3 } },
  hard:   { numColors: 4, numStyles: 4, totalItems: [7, 10], patternProb: 0.25,
            rulesPerPlayer: 4, pertRange: [7, 10], warmCoolBias: 1.5,
            pertWeights: { paint: 1.0, swap: 1.2, remove: 1.0, add: 0.5 } },
};

// ================================================================
// SECTION 2: SEEDED RANDOM
// ================================================================

class SeededRandom {
  constructor(seed) {
    this.s = (seed != null ? Math.abs(seed | 0) : (Date.now() | 0)) || 1;
  }
  /** Mulberry32 PRNG — returns [0, 1) */
  random() {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  randint(lo, hi) { return lo + Math.floor(this.random() * (hi - lo + 1)); }
  uniform(lo, hi) { return lo + this.random() * (hi - lo); }
  choice(arr) { return arr[Math.floor(this.random() * arr.length)]; }
  shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  sample(arr, n) { return this.shuffle(arr).slice(0, n); }
  /** Weighted index selection. Returns index into weights array. */
  weightedIndex(weights) {
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) return -1;
    let r = this.random() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }
}

// ================================================================
// SECTION 3: STATE REPRESENTATION
// ================================================================

function makeToken(objType, style) {
  return { objType, style, color: STYLE_TO_COLOR[objType][style] };
}

class Room {
  constructor(name, wallColor) {
    this.name = name;
    this.wallColor = wallColor;
    this.lamp = null;
    this.wallHanging = null;
    this.curio = null;
  }
  getObject(ot) { return this[SLOT_KEY[ot]]; }
  setObject(ot, token) { this[SLOT_KEY[ot]] = token; }
  getObjects() { return [this.lamp, this.wallHanging, this.curio].filter(Boolean); }
  objectCount() { return this.getObjects().length; }
  hasStyle(st) { return this.getObjects().some(o => o.style === st); }
  hasObjColor(c) { return this.getObjects().some(o => o.color === c); }
}

class HouseState {
  constructor(numPlayers) {
    this.numPlayers = numPlayers;
    this.roomNames = numPlayers === 2 ? [...ROOMS_2P] : [...ROOMS_34P];
    this.rooms = {};
    for (const rn of this.roomNames) this.rooms[rn] = new Room(rn, 'Red');
  }
  get layout() { return this.numPlayers === 2 ? LAYOUT_2P : LAYOUT_34P; }

  getAllObjects() {
    const out = [];
    for (const rn of this.roomNames) out.push(...this.rooms[rn].getObjects());
    return out;
  }
  areaRoomNames(area) { return this.layout[area]; }
  countRoomsColor(color) { return this.roomNames.filter(rn => this.rooms[rn].wallColor === color).length; }
  countObjColor(color) { return this.getAllObjects().filter(o => o.color === color).length; }
  countObjStyle(style) { return this.getAllObjects().filter(o => o.style === style).length; }
  countObjType(ot) { return this.roomNames.filter(rn => this.rooms[rn].getObject(ot) !== null).length; }
  countWarm() { return this.getAllObjects().filter(o => WARM_COLORS.has(o.color)).length; }
  countCool() { return this.getAllObjects().filter(o => COOL_COLORS.has(o.color)).length; }

  // Actions (for perturbation)
  addObject(rn, token) {
    if (this.rooms[rn].getObject(token.objType) !== null) return false;
    this.rooms[rn].setObject(token.objType, token);
    return true;
  }
  removeObject(rn, ot) {
    const old = this.rooms[rn].getObject(ot);
    if (!old) return null;
    this.rooms[rn].setObject(ot, null);
    return old;
  }
  swapObject(rn, token) {
    const old = this.rooms[rn].getObject(token.objType);
    if (!old) return null;
    this.rooms[rn].setObject(token.objType, token);
    return old;
  }
  paintRoom(rn, color) {
    const old = this.rooms[rn].wallColor;
    this.rooms[rn].wallColor = color;
    return old;
  }

  deepCopy() {
    const copy = new HouseState(this.numPlayers);
    for (const rn of this.roomNames) {
      const r = this.rooms[rn];
      copy.rooms[rn] = new Room(r.name, r.wallColor);
      for (const ot of OBJECT_TYPES) {
        const obj = r.getObject(ot);
        if (obj) copy.rooms[rn].setObject(ot, makeToken(obj.objType, obj.style));
      }
    }
    return copy;
  }
  fingerprint() {
    const parts = [];
    for (const rn of [...this.roomNames].sort()) {
      const r = this.rooms[rn];
      parts.push(r.wallColor);
      for (const ot of OBJECT_TYPES) {
        const obj = r.getObject(ot);
        parts.push(obj ? obj.style : '');
      }
    }
    return parts.join('|');
  }
  serialize() {
    return {
      numPlayers: this.numPlayers,
      rooms: this.roomNames.map(rn => {
        const r = this.rooms[rn];
        const obj = (ot) => { const o = r.getObject(ot); return o ? { style: o.style, color: o.color } : null; };
        return { name: rn, wallColor: r.wallColor, lamp: obj('Lamp'), wallHanging: obj('Wall Hanging'), curio: obj('Curio') };
      }),
      layout: this.layout,
    };
  }
}

// ================================================================
// SECTION 4: CONSTRAINT TYPES & EVALUATION
// ================================================================

const CType = {
  ROOM_WALL_COLOR_IS: 'ROOM_WALL_COLOR_IS',
  ROOM_WALL_COLOR_IS_NOT: 'ROOM_WALL_COLOR_IS_NOT',
  ROOM_WALL_WARM: 'ROOM_WALL_WARM',
  ROOM_WALL_COOL: 'ROOM_WALL_COOL',
  ROOM_HAS_OBJECT_TYPE: 'ROOM_HAS_OBJECT_TYPE',
  ROOM_NO_OBJECT_TYPE: 'ROOM_NO_OBJECT_TYPE',
  ROOM_HAS_STYLE: 'ROOM_HAS_STYLE',
  ROOM_NO_STYLE: 'ROOM_NO_STYLE',
  ROOM_HAS_COLOR_OBJECT: 'ROOM_HAS_COLOR_OBJECT',
  ROOM_NO_COLOR_OBJECT: 'ROOM_NO_COLOR_OBJECT',
  AREA_HAS_OBJECT_TYPE: 'AREA_HAS_OBJECT_TYPE',
  AREA_NO_OBJECT_TYPE: 'AREA_NO_OBJECT_TYPE',
  AREA_HAS_COLOR_OBJECT: 'AREA_HAS_COLOR_OBJECT',
  AREA_NO_COLOR_OBJECT: 'AREA_NO_COLOR_OBJECT',
  AREA_HAS_STYLE: 'AREA_HAS_STYLE',
  AREA_NO_STYLE: 'AREA_NO_STYLE',
  EXACTLY_N_ROOMS_COLOR: 'EXACTLY_N_ROOMS_COLOR',
  AT_LEAST_N_OBJECT_TYPE: 'AT_LEAST_N_OBJECT_TYPE',
  AT_LEAST_N_COLOR_OBJECTS: 'AT_LEAST_N_COLOR_OBJECTS',
  AT_LEAST_N_STYLE_OBJECTS: 'AT_LEAST_N_STYLE_OBJECTS',
  NO_COLOR_OBJECTS_IN_HOUSE: 'NO_COLOR_OBJECTS_IN_HOUSE',
  ALL_OBJECT_TYPE_SAME_COLOR: 'ALL_OBJECT_TYPE_SAME_COLOR',
  ALL_OBJECT_TYPE_SAME_STYLE: 'ALL_OBJECT_TYPE_SAME_STYLE',
  COLOR_ROOM_COUNT_EQUAL: 'COLOR_ROOM_COUNT_EQUAL',
  ROOM_WITH_TYPE_MUST_HAVE_TYPE: 'ROOM_WITH_TYPE_MUST_HAVE_TYPE',
  NO_ROOM_MORE_THAN_ONE_STYLE: 'NO_ROOM_MORE_THAN_ONE_STYLE',
  AT_LEAST_N_WARM_OBJECTS: 'AT_LEAST_N_WARM_OBJECTS',
  AT_LEAST_N_COOL_OBJECTS: 'AT_LEAST_N_COOL_OBJECTS',
  // Spatial
  DIAG_STYLE_NO_WALL_COLOR: 'DIAG_STYLE_NO_WALL_COLOR',
  ADJ_STYLE_NO_WALL_COLOR: 'ADJ_STYLE_NO_WALL_COLOR',
  ABOVE_STYLE_NO_WALL_COLOR: 'ABOVE_STYLE_NO_WALL_COLOR',
  BELOW_STYLE_NO_WALL_COLOR: 'BELOW_STYLE_NO_WALL_COLOR',
  BESIDE_STYLE_NO_WALL_COLOR: 'BESIDE_STYLE_NO_WALL_COLOR',
  DIAG_ROOMS_SAME_WALL: 'DIAG_ROOMS_SAME_WALL',
  ADJ_ROOMS_DIFF_WALL: 'ADJ_ROOMS_DIFF_WALL',
  // Conditional
  WALL_COLOR_FORBIDS_STYLE: 'WALL_COLOR_FORBIDS_STYLE',
  STYLE_PAIR_FORBIDDEN: 'STYLE_PAIR_FORBIDDEN',
  OBJ_TYPE_REQUIRES_WALL_COLOR: 'OBJ_TYPE_REQUIRES_WALL_COLOR',
  WALL_COLOR_FORBIDS_OBJ_COLOR: 'WALL_COLOR_FORBIDS_OBJ_COLOR',
  OBJ_TYPE_FORBIDS_OBJ_TYPE: 'OBJ_TYPE_FORBIDS_OBJ_TYPE',
  // Funky
  MORE_WARM_THAN_COOL: 'MORE_WARM_THAN_COOL',
  MORE_COOL_THAN_WARM: 'MORE_COOL_THAN_WARM',
  WALL_MATCHES_OBJECT: 'WALL_MATCHES_OBJECT',
  NO_WALL_MATCHES_OBJECT: 'NO_WALL_MATCHES_OBJECT',
  COLOR_EXCLUSION_ZONE: 'COLOR_EXCLUSION_ZONE',
  // Quantity comparison
  MORE_OBJ_COLOR_THAN_STYLE: 'MORE_OBJ_COLOR_THAN_STYLE',
  MORE_OBJ_STYLE_THAN_COLOR: 'MORE_OBJ_STYLE_THAN_COLOR',
  MORE_TYPE_IN_AREA_THAN_TYPE_IN_AREA: 'MORE_TYPE_IN_AREA_THAN_TYPE_IN_AREA',
  MORE_COLOR_THAN_COLOR: 'MORE_COLOR_THAN_COLOR',
};

/** Helper: get all objects in an area */
function areaObjects(s, area) {
  return s.areaRoomNames(area).flatMap(rn => s.rooms[rn].getObjects());
}

const EVAL = {
  [CType.ROOM_WALL_COLOR_IS]:     (p, s) => s.rooms[p.room].wallColor === p.color,
  [CType.ROOM_WALL_COLOR_IS_NOT]: (p, s) => s.rooms[p.room].wallColor !== p.color,
  [CType.ROOM_WALL_WARM]:         (p, s) => WARM_COLORS.has(s.rooms[p.room].wallColor),
  [CType.ROOM_WALL_COOL]:         (p, s) => COOL_COLORS.has(s.rooms[p.room].wallColor),
  [CType.ROOM_HAS_OBJECT_TYPE]:   (p, s) => s.rooms[p.room].getObject(p.objType) !== null,
  [CType.ROOM_NO_OBJECT_TYPE]:    (p, s) => s.rooms[p.room].getObject(p.objType) === null,
  [CType.ROOM_HAS_STYLE]:         (p, s) => s.rooms[p.room].hasStyle(p.style),
  [CType.ROOM_NO_STYLE]:          (p, s) => !s.rooms[p.room].hasStyle(p.style),
  [CType.ROOM_HAS_COLOR_OBJECT]:  (p, s) => s.rooms[p.room].hasObjColor(p.color),
  [CType.ROOM_NO_COLOR_OBJECT]:   (p, s) => !s.rooms[p.room].hasObjColor(p.color),
  [CType.AREA_HAS_OBJECT_TYPE]:   (p, s) => s.areaRoomNames(p.area).some(rn => s.rooms[rn].getObject(p.objType) !== null),
  [CType.AREA_NO_OBJECT_TYPE]:    (p, s) => s.areaRoomNames(p.area).every(rn => s.rooms[rn].getObject(p.objType) === null),
  [CType.AREA_HAS_COLOR_OBJECT]:  (p, s) => areaObjects(s, p.area).some(o => o.color === p.color),
  [CType.AREA_NO_COLOR_OBJECT]:   (p, s) => !areaObjects(s, p.area).some(o => o.color === p.color),
  [CType.AREA_HAS_STYLE]:         (p, s) => areaObjects(s, p.area).some(o => o.style === p.style),
  [CType.AREA_NO_STYLE]:          (p, s) => !areaObjects(s, p.area).some(o => o.style === p.style),
  [CType.EXACTLY_N_ROOMS_COLOR]:  (p, s) => s.countRoomsColor(p.color) === p.n,
  [CType.AT_LEAST_N_OBJECT_TYPE]: (p, s) => s.countObjType(p.objType) >= p.n,
  [CType.AT_LEAST_N_COLOR_OBJECTS]: (p, s) => s.countObjColor(p.color) >= p.n,
  [CType.AT_LEAST_N_STYLE_OBJECTS]: (p, s) => s.countObjStyle(p.style) >= p.n,
  [CType.NO_COLOR_OBJECTS_IN_HOUSE]: (p, s) => s.countObjColor(p.color) === 0,
  [CType.ALL_OBJECT_TYPE_SAME_COLOR]: (p, s) => {
    const objs = s.roomNames.map(rn => s.rooms[rn].getObject(p.objType)).filter(Boolean);
    return objs.length < 2 || objs.every(o => o.color === p.color);
  },
  [CType.ALL_OBJECT_TYPE_SAME_STYLE]: (p, s) => {
    const objs = s.roomNames.map(rn => s.rooms[rn].getObject(p.objType)).filter(Boolean);
    return objs.length < 2 || objs.every(o => o.style === p.style);
  },
  [CType.COLOR_ROOM_COUNT_EQUAL]:    (p, s) => s.countRoomsColor(p.colorA) === s.countRoomsColor(p.colorB),
  [CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE]: (p, s) => s.roomNames.every(rn =>
    s.rooms[rn].getObject(p.objTypeA) === null || s.rooms[rn].getObject(p.objTypeB) !== null),
  [CType.NO_ROOM_MORE_THAN_ONE_STYLE]: (p, s) => s.roomNames.every(rn =>
    s.rooms[rn].getObjects().filter(o => o.style === p.style).length <= 1),
  [CType.AT_LEAST_N_WARM_OBJECTS]: (p, s) => s.countWarm() >= p.n,
  [CType.AT_LEAST_N_COOL_OBJECTS]: (p, s) => s.countCool() >= p.n,

  // ── Spatial ──────────────────────────────────────────────
  [CType.DIAG_STYLE_NO_WALL_COLOR]: (p, s) => {
    for (const rn of s.roomNames) {
      if (s.rooms[rn].hasStyle(p.style)) {
        const d = getRoomDiagonal(rn, s.numPlayers);
        if (d && s.rooms[d].wallColor === p.color) return false;
      }
    }
    return true;
  },
  [CType.ADJ_STYLE_NO_WALL_COLOR]: (p, s) => {
    for (const rn of s.roomNames) {
      if (s.rooms[rn].hasStyle(p.style)) {
        for (const adj of getAdjacentRooms(rn, s.numPlayers))
          if (s.rooms[adj].wallColor === p.color) return false;
      }
    }
    return true;
  },
  [CType.ABOVE_STYLE_NO_WALL_COLOR]: (p, s) => {
    for (const rn of s.roomNames) {
      if (s.rooms[rn].hasStyle(p.style)) {
        const a = getRoomAbove(rn, s.numPlayers);
        if (a && s.rooms[a].wallColor === p.color) return false;
      }
    }
    return true;
  },
  [CType.BELOW_STYLE_NO_WALL_COLOR]: (p, s) => {
    for (const rn of s.roomNames) {
      if (s.rooms[rn].hasStyle(p.style)) {
        const b = getRoomBelow(rn, s.numPlayers);
        if (b && s.rooms[b].wallColor === p.color) return false;
      }
    }
    return true;
  },
  [CType.BESIDE_STYLE_NO_WALL_COLOR]: (p, s) => {
    for (const rn of s.roomNames) {
      if (s.rooms[rn].hasStyle(p.style)) {
        const b = getRoomBeside(rn, s.numPlayers);
        if (b && s.rooms[b].wallColor === p.color) return false;
      }
    }
    return true;
  },
  [CType.DIAG_ROOMS_SAME_WALL]: (p, s) =>
    getDiagonalPairs(s.numPlayers).every(([a, b]) => s.rooms[a].wallColor === s.rooms[b].wallColor),
  [CType.ADJ_ROOMS_DIFF_WALL]: (p, s) =>
    getAdjacentPairs(s.numPlayers).every(([a, b]) => s.rooms[a].wallColor !== s.rooms[b].wallColor),

  // ── Conditional ──────────────────────────────────────────
  [CType.WALL_COLOR_FORBIDS_STYLE]: (p, s) =>
    s.roomNames.every(rn => s.rooms[rn].wallColor !== p.color || !s.rooms[rn].hasStyle(p.style)),
  [CType.STYLE_PAIR_FORBIDDEN]: (p, s) =>
    s.roomNames.every(rn => !s.rooms[rn].hasStyle(p.styleA) || !s.rooms[rn].hasStyle(p.styleB)),
  [CType.OBJ_TYPE_REQUIRES_WALL_COLOR]: (p, s) =>
    s.roomNames.every(rn => s.rooms[rn].getObject(p.objType) === null || s.rooms[rn].wallColor === p.color),
  [CType.WALL_COLOR_FORBIDS_OBJ_COLOR]: (p, s) =>
    s.roomNames.every(rn => s.rooms[rn].wallColor !== p.wallColor || !s.rooms[rn].hasObjColor(p.objColor)),
  [CType.OBJ_TYPE_FORBIDS_OBJ_TYPE]: (p, s) =>
    s.roomNames.every(rn => s.rooms[rn].getObject(p.objTypeA) === null || s.rooms[rn].getObject(p.objTypeB) === null),

  // ── Funky ────────────────────────────────────────────────
  [CType.MORE_WARM_THAN_COOL]: (p, s) => s.countWarm() > s.countCool(),
  [CType.MORE_COOL_THAN_WARM]: (p, s) => s.countCool() > s.countWarm(),
  [CType.WALL_MATCHES_OBJECT]: (p, s) =>
    s.roomNames.every(rn => s.rooms[rn].objectCount() === 0 || s.rooms[rn].hasObjColor(s.rooms[rn].wallColor)),
  [CType.NO_WALL_MATCHES_OBJECT]: (p, s) =>
    s.roomNames.every(rn => !s.rooms[rn].hasObjColor(s.rooms[rn].wallColor)),
  [CType.COLOR_EXCLUSION_ZONE]: (p, s) => {
    const ct = s.roomNames.filter(rn => s.rooms[rn].wallColor === p.color && s.rooms[rn].getObject(p.objType) !== null).length;
    return ct <= 1;
  },

  // ── Quantity comparison ──────────────────────────────────
  [CType.MORE_OBJ_COLOR_THAN_STYLE]: (p, s) => s.countObjColor(p.color) > s.countObjStyle(p.style),
  [CType.MORE_OBJ_STYLE_THAN_COLOR]: (p, s) => s.countObjStyle(p.style) > s.countObjColor(p.color),
  [CType.MORE_TYPE_IN_AREA_THAN_TYPE_IN_AREA]: (p, s) => {
    const cA = s.areaRoomNames(p.areaA).filter(rn => s.rooms[rn].getObject(p.objTypeA) !== null).length;
    const cB = s.areaRoomNames(p.areaB).filter(rn => s.rooms[rn].getObject(p.objTypeB) !== null).length;
    return cA > cB;
  },
  [CType.MORE_COLOR_THAN_COLOR]: (p, s) => s.countObjColor(p.colorA) > s.countObjColor(p.colorB),
};

function evalC(c, state) {
  const fn = EVAL[c.ctype];
  if (!fn) throw new Error(`Unknown constraint: ${c.ctype}`);
  return fn(c.params, state);
}

// ================================================================
// SECTION 5: CANDIDATE CONSTRAINT GENERATION
// ================================================================

function generateCandidates(state) {
  const cands = [];
  const add = (ctype, params, score) => {
    const c = { ctype, params, score };
    cands.push(c);
  };

  for (const rn of state.roomNames) {
    const room = state.rooms[rn];
    for (const color of COLORS) {
      if (room.wallColor === color) add(CType.ROOM_WALL_COLOR_IS, { room: rn, color }, 6.0);
      else add(CType.ROOM_WALL_COLOR_IS_NOT, { room: rn, color }, 3.0);
    }
    if (WARM_COLORS.has(room.wallColor)) add(CType.ROOM_WALL_WARM, { room: rn }, 4.0);
    else add(CType.ROOM_WALL_COOL, { room: rn }, 4.0);

    for (const ot of OBJECT_TYPES) {
      if (room.getObject(ot)) add(CType.ROOM_HAS_OBJECT_TYPE, { room: rn, objType: ot }, 5.0);
      else add(CType.ROOM_NO_OBJECT_TYPE, { room: rn, objType: ot }, 4.0);
    }
    for (const st of STYLES) {
      if (room.hasStyle(st)) add(CType.ROOM_HAS_STYLE, { room: rn, style: st }, 5.5);
      else add(CType.ROOM_NO_STYLE, { room: rn, style: st }, room.objectCount() > 0 ? 4.5 : 2.0);
    }
    for (const color of COLORS) {
      if (room.hasObjColor(color)) add(CType.ROOM_HAS_COLOR_OBJECT, { room: rn, color }, 5.0);
      else add(CType.ROOM_NO_COLOR_OBJECT, { room: rn, color }, room.objectCount() > 0 ? 4.0 : 2.0);
    }
  }

  for (const area of AREA_NAMES) {
    const arns = state.areaRoomNames(area);
    const aObjs = arns.flatMap(rn => state.rooms[rn].getObjects());
    const hasObjs = aObjs.length > 0;
    for (const ot of OBJECT_TYPES) {
      if (arns.some(rn => state.rooms[rn].getObject(ot))) add(CType.AREA_HAS_OBJECT_TYPE, { area, objType: ot }, 6.0);
      else add(CType.AREA_NO_OBJECT_TYPE, { area, objType: ot }, 5.5);
    }
    for (const color of COLORS) {
      if (aObjs.some(o => o.color === color)) add(CType.AREA_HAS_COLOR_OBJECT, { area, color }, 5.5);
      else add(CType.AREA_NO_COLOR_OBJECT, { area, color }, hasObjs ? 5.0 : 2.0);
    }
    for (const st of STYLES) {
      if (aObjs.some(o => o.style === st)) add(CType.AREA_HAS_STYLE, { area, style: st }, 5.5);
      else add(CType.AREA_NO_STYLE, { area, style: st }, hasObjs ? 5.0 : 2.0);
    }
  }

  for (const color of COLORS) {
    const nw = state.countRoomsColor(color);
    if (nw >= 1 && nw <= 3) add(CType.EXACTLY_N_ROOMS_COLOR, { color, n: nw }, nw <= 2 ? 7.0 : 5.5);
    const no = state.countObjColor(color);
    if (no === 0) { add(CType.NO_COLOR_OBJECTS_IN_HOUSE, { color }, 6.0); }
    else {
      for (let k = Math.max(1, no - 1); k <= no; k++)
        add(CType.AT_LEAST_N_COLOR_OBJECTS, { color, n: k }, 4.0 + 2.5 * (k / no));
    }
  }
  for (const ot of OBJECT_TYPES) {
    const ct = state.countObjType(ot);
    if (ct >= 2) for (let k = Math.max(2, ct - 1); k <= ct; k++)
      add(CType.AT_LEAST_N_OBJECT_TYPE, { objType: ot, n: k }, 4.0 + 2.0 * (k / ct));
  }
  for (const st of STYLES) {
    const ct = state.countObjStyle(st);
    if (ct >= 2) for (let k = Math.max(2, ct - 1); k <= ct; k++)
      add(CType.AT_LEAST_N_STYLE_OBJECTS, { style: st, n: k }, 4.0 + 2.0 * (k / ct));
  }

  // Global qualitative
  for (const ot of OBJECT_TYPES) {
    const objs = state.roomNames.map(rn => state.rooms[rn].getObject(ot)).filter(Boolean);
    if (objs.length >= 2) {
      const cols = new Set(objs.map(o => o.color));
      const stys = new Set(objs.map(o => o.style));
      if (cols.size === 1) add(CType.ALL_OBJECT_TYPE_SAME_COLOR, { objType: ot, color: [...cols][0] }, 7.5);
      if (stys.size === 1) add(CType.ALL_OBJECT_TYPE_SAME_STYLE, { objType: ot, style: [...stys][0] }, 7.5);
    }
  }

  // Relational
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = i + 1; j < COLORS.length; j++) {
      const cA = COLORS[i], cB = COLORS[j];
      if (state.countRoomsColor(cA) === state.countRoomsColor(cB)) {
        const both = state.countRoomsColor(cA) > 0 && state.countRoomsColor(cB) > 0;
        add(CType.COLOR_ROOM_COUNT_EQUAL, { colorA: cA, colorB: cB }, both ? 7.5 : 4.0);
      }
    }
  }
  for (const tA of OBJECT_TYPES) {
    for (const tB of OBJECT_TYPES) {
      if (tA === tB) continue;
      let valid = true, hasTa = false;
      for (const rn of state.roomNames) {
        if (state.rooms[rn].getObject(tA)) { hasTa = true; if (!state.rooms[rn].getObject(tB)) { valid = false; break; } }
      }
      if (valid && hasTa) add(CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE, { objTypeA: tA, objTypeB: tB }, 8.0);
    }
  }
  for (const st of STYLES) {
    let valid = true, exists = false;
    for (const rn of state.roomNames) {
      const ct = state.rooms[rn].getObjects().filter(o => o.style === st).length;
      if (ct >= 1) exists = true;
      if (ct > 1) { valid = false; break; }
    }
    if (valid && exists) add(CType.NO_ROOM_MORE_THAN_ONE_STYLE, { style: st }, 6.5);
  }

  // Temperature
  const wc = state.countWarm(), cc = state.countCool();
  if (wc >= 2) add(CType.AT_LEAST_N_WARM_OBJECTS, { n: wc }, 5.0);
  if (wc >= 3) add(CType.AT_LEAST_N_WARM_OBJECTS, { n: wc - 1 }, 4.0);
  if (cc >= 2) add(CType.AT_LEAST_N_COOL_OBJECTS, { n: cc }, 5.0);
  if (cc >= 3) add(CType.AT_LEAST_N_COOL_OBJECTS, { n: cc - 1 }, 4.0);

  // ── Spatial constraints ──────────────────────────────────
  const _hasStyle = st => state.roomNames.some(rn => state.rooms[rn].hasStyle(st));
  for (const st of STYLES) {
    if (!_hasStyle(st)) continue;
    for (const color of COLORS) {
      const dp = { style: st, color };
      if (evalC({ ctype: CType.DIAG_STYLE_NO_WALL_COLOR, params: dp }, state))
        add(CType.DIAG_STYLE_NO_WALL_COLOR, dp, 7.0);
      if (evalC({ ctype: CType.ADJ_STYLE_NO_WALL_COLOR, params: dp }, state))
        add(CType.ADJ_STYLE_NO_WALL_COLOR, dp, 6.5);
      // ABOVE: only meaningful if a style room sits on the bottom floor
      if (state.roomNames.some(rn => state.rooms[rn].hasStyle(st) && getRoomAbove(rn, state.numPlayers)) &&
          evalC({ ctype: CType.ABOVE_STYLE_NO_WALL_COLOR, params: dp }, state))
        add(CType.ABOVE_STYLE_NO_WALL_COLOR, dp, 6.5);
      // BELOW: only meaningful if a style room sits on the top floor
      if (state.roomNames.some(rn => state.rooms[rn].hasStyle(st) && getRoomBelow(rn, state.numPlayers)) &&
          evalC({ ctype: CType.BELOW_STYLE_NO_WALL_COLOR, params: dp }, state))
        add(CType.BELOW_STYLE_NO_WALL_COLOR, dp, 6.5);
      if (evalC({ ctype: CType.BESIDE_STYLE_NO_WALL_COLOR, params: dp }, state))
        add(CType.BESIDE_STYLE_NO_WALL_COLOR, dp, 6.5);
    }
  }
  if (evalC({ ctype: CType.DIAG_ROOMS_SAME_WALL, params: {} }, state))
    add(CType.DIAG_ROOMS_SAME_WALL, {}, 7.5);
  if (evalC({ ctype: CType.ADJ_ROOMS_DIFF_WALL, params: {} }, state))
    add(CType.ADJ_ROOMS_DIFF_WALL, {}, 8.0);

  // ── Conditional constraints ──────────────────────────────
  for (const color of COLORS) {
    const hasColorRoom = state.roomNames.some(rn => state.rooms[rn].wallColor === color);
    if (!hasColorRoom) continue;
    for (const st of STYLES) {
      if (evalC({ ctype: CType.WALL_COLOR_FORBIDS_STYLE, params: { color, style: st } }, state)) {
        const hasIt = _hasStyle(st);
        add(CType.WALL_COLOR_FORBIDS_STYLE, { color, style: st }, hasIt ? 7.5 : 5.0);
      }
    }
    for (const oc of COLORS) {
      if (evalC({ ctype: CType.WALL_COLOR_FORBIDS_OBJ_COLOR, params: { wallColor: color, objColor: oc } }, state)) {
        const hasOC = state.countObjColor(oc) > 0;
        add(CType.WALL_COLOR_FORBIDS_OBJ_COLOR, { wallColor: color, objColor: oc }, hasOC ? 7.0 : 4.5);
      }
    }
  }
  for (let i = 0; i < STYLES.length; i++) {
    for (let j = i + 1; j < STYLES.length; j++) {
      if (evalC({ ctype: CType.STYLE_PAIR_FORBIDDEN, params: { styleA: STYLES[i], styleB: STYLES[j] } }, state)) {
        const both = _hasStyle(STYLES[i]) && _hasStyle(STYLES[j]);
        add(CType.STYLE_PAIR_FORBIDDEN, { styleA: STYLES[i], styleB: STYLES[j] }, both ? 7.0 : 4.0);
      }
    }
  }
  for (const ot of OBJECT_TYPES) {
    const roomsWT = state.roomNames.filter(rn => state.rooms[rn].getObject(ot) !== null);
    if (roomsWT.length === 0) continue;
    for (const color of COLORS) {
      if (roomsWT.every(rn => state.rooms[rn].wallColor === color))
        add(CType.OBJ_TYPE_REQUIRES_WALL_COLOR, { objType: ot, color }, roomsWT.length >= 2 ? 8.0 : 6.0);
    }
  }
  for (let i = 0; i < OBJECT_TYPES.length; i++) {
    for (let j = i + 1; j < OBJECT_TYPES.length; j++) {
      if (evalC({ ctype: CType.OBJ_TYPE_FORBIDS_OBJ_TYPE, params: { objTypeA: OBJECT_TYPES[i], objTypeB: OBJECT_TYPES[j] } }, state)) {
        const aE = state.countObjType(OBJECT_TYPES[i]) > 0, bE = state.countObjType(OBJECT_TYPES[j]) > 0;
        if (aE && bE) add(CType.OBJ_TYPE_FORBIDS_OBJ_TYPE, { objTypeA: OBJECT_TYPES[i], objTypeB: OBJECT_TYPES[j] }, 7.5);
      }
    }
  }

  // ── Funky constraints ────────────────────────────────────
  if (wc > cc) add(CType.MORE_WARM_THAN_COOL, {}, 6.5);
  if (cc > wc) add(CType.MORE_COOL_THAN_WARM, {}, 6.5);
  if (evalC({ ctype: CType.WALL_MATCHES_OBJECT, params: {} }, state)) {
    const roomsWithObj = state.roomNames.filter(rn => state.rooms[rn].objectCount() > 0);
    if (roomsWithObj.some(rn => state.rooms[rn].hasObjColor(state.rooms[rn].wallColor)))
      add(CType.WALL_MATCHES_OBJECT, {}, 8.0);
  }
  if (evalC({ ctype: CType.NO_WALL_MATCHES_OBJECT, params: {} }, state))
    add(CType.NO_WALL_MATCHES_OBJECT, {}, 7.5);
  for (const color of COLORS) {
    const colorRooms = state.roomNames.filter(rn => state.rooms[rn].wallColor === color);
    if (colorRooms.length < 2) continue;
    for (const ot of OBJECT_TYPES) {
      const withType = colorRooms.filter(rn => state.rooms[rn].getObject(ot) !== null);
      if (withType.length <= 1)
        add(CType.COLOR_EXCLUSION_ZONE, { color, objType: ot }, withType.length === 1 ? 7.5 : 5.0);
    }
  }

  // ── Quantity comparison ──────────────────────────────────
  for (const color of COLORS) {
    for (const st of STYLES) {
      const co = state.countObjColor(color), so = state.countObjStyle(st);
      if (co > so && co >= 1) add(CType.MORE_OBJ_COLOR_THAN_STYLE, { color, style: st }, 6.0 + Math.min(co - so, 3));
      if (so > co && so >= 1) add(CType.MORE_OBJ_STYLE_THAN_COLOR, { style: st, color }, 6.0 + Math.min(so - co, 3));
    }
  }
  for (const otA of OBJECT_TYPES) {
    for (const areaA of VERTICAL_AREAS) {
      const cA = state.areaRoomNames(areaA).filter(rn => state.rooms[rn].getObject(otA) !== null).length;
      if (cA === 0) continue;
      for (const otB of OBJECT_TYPES) {
        for (const areaB of VERTICAL_AREAS) {
          if (otA === otB && areaA === areaB) continue;
          const cB = state.areaRoomNames(areaB).filter(rn => state.rooms[rn].getObject(otB) !== null).length;
          if (cA > cB) add(CType.MORE_TYPE_IN_AREA_THAN_TYPE_IN_AREA, { objTypeA: otA, areaA, objTypeB: otB, areaB }, 6.5);
        }
      }
    }
  }
  for (let i = 0; i < COLORS.length; i++) {
    for (let j = 0; j < COLORS.length; j++) {
      if (i === j) continue;
      const cI = state.countObjColor(COLORS[i]), cJ = state.countObjColor(COLORS[j]);
      if (cI > cJ && cI >= 1) add(CType.MORE_COLOR_THAN_COLOR, { colorA: COLORS[i], colorB: COLORS[j] }, 6.0 + Math.min(cI - cJ, 3));
    }
  }

  return cands;
}

// ================================================================
// SECTION 6: NATURAL LANGUAGE RENDERING
// ================================================================

const NL = {
  [CType.ROOM_WALL_COLOR_IS]:       'The {room} must be painted {color}.',
  [CType.ROOM_WALL_COLOR_IS_NOT]:   'The {room} must not be painted {color}.',
  [CType.ROOM_WALL_WARM]:           'The {room} must be painted a warm color.',
  [CType.ROOM_WALL_COOL]:           'The {room} must be painted a cool color.',
  [CType.ROOM_HAS_OBJECT_TYPE]:     'The {room} must contain a {objTypeLower}.',
  [CType.ROOM_NO_OBJECT_TYPE]:      'The {room} must not contain a {objTypeLower}.',
  [CType.ROOM_HAS_STYLE]:           'The {room} must contain at least one {styleLower} item.',
  [CType.ROOM_NO_STYLE]:            'The {room} must not contain any {styleLower} items.',
  [CType.ROOM_HAS_COLOR_OBJECT]:    'The {room} must contain at least one {color} object.',
  [CType.ROOM_NO_COLOR_OBJECT]:     'The {room} must not contain any {color} objects.',
  [CType.AREA_HAS_OBJECT_TYPE]:     'The {area} must contain a {objTypeLower}.',
  [CType.AREA_NO_OBJECT_TYPE]:      'The {area} must not contain any {objTypePlural}.',
  [CType.AREA_HAS_COLOR_OBJECT]:    'The {area} must contain at least one {color} object.',
  [CType.AREA_NO_COLOR_OBJECT]:     'The {area} must not contain any {color} objects.',
  [CType.AREA_HAS_STYLE]:           'The {area} must contain at least one {styleLower} item.',
  [CType.AREA_NO_STYLE]:            'The {area} must not contain any {styleLower} items.',
  [CType.EXACTLY_N_ROOMS_COLOR]:    'Exactly {n} {roomWord} must be painted {color}.',
  [CType.AT_LEAST_N_OBJECT_TYPE]:   'There must be at least {n} {objTypePlural} in the house.',
  [CType.AT_LEAST_N_COLOR_OBJECTS]: 'There must be at least {n} {color} {objWord} in the house.',
  [CType.AT_LEAST_N_STYLE_OBJECTS]: 'There must be at least {n} {styleLower} {objWord} in the house.',
  [CType.NO_COLOR_OBJECTS_IN_HOUSE]:'There must not be any {color} objects in the house.',
  [CType.ALL_OBJECT_TYPE_SAME_COLOR]:'All {objTypePlural} in the house must be {color}.',
  [CType.ALL_OBJECT_TYPE_SAME_STYLE]:'All {objTypePlural} in the house must be {styleLower}.',
  [CType.COLOR_ROOM_COUNT_EQUAL]:   'The number of {colorA} rooms must equal the number of {colorB} rooms.',
  [CType.ROOM_WITH_TYPE_MUST_HAVE_TYPE]: 'Any room with a {objTypeALower} must also contain a {objTypeBLower}.',
  [CType.NO_ROOM_MORE_THAN_ONE_STYLE]:  'No room may contain more than one {styleLower} item.',
  [CType.AT_LEAST_N_WARM_OBJECTS]:  'There must be at least {n} warm-colored {objWord} in the house.',
  [CType.AT_LEAST_N_COOL_OBJECTS]:  'There must be at least {n} cool-colored {objWord} in the house.',
  // Spatial
  [CType.DIAG_STYLE_NO_WALL_COLOR]:   'The room diagonally opposite any room with a {styleLower} item must not be painted {color}.',
  [CType.ADJ_STYLE_NO_WALL_COLOR]:    'Rooms adjacent to any room containing a {styleLower} item must not be painted {color}.',
  [CType.ABOVE_STYLE_NO_WALL_COLOR]:  'The room directly above any room with a {styleLower} item must not be painted {color}.',
  [CType.BELOW_STYLE_NO_WALL_COLOR]:  'The room directly below any room with a {styleLower} item must not be painted {color}.',
  [CType.BESIDE_STYLE_NO_WALL_COLOR]: 'The room beside any room containing a {styleLower} item must not be painted {color}.',
  [CType.DIAG_ROOMS_SAME_WALL]:       'Diagonally opposite rooms must be painted the same color.',
  [CType.ADJ_ROOMS_DIFF_WALL]:        'No two adjacent rooms may be painted the same color.',
  // Conditional
  [CType.WALL_COLOR_FORBIDS_STYLE]:     'Rooms painted {color} must not contain {styleLower} items.',
  [CType.STYLE_PAIR_FORBIDDEN]:         'No room may contain both a {styleALower} and a {styleBLower} item.',
  [CType.OBJ_TYPE_REQUIRES_WALL_COLOR]: 'Any room with a {objTypeLower} must be painted {color}.',
  [CType.WALL_COLOR_FORBIDS_OBJ_COLOR]: '{wallColor} rooms must not contain {objColor} objects.',
  [CType.OBJ_TYPE_FORBIDS_OBJ_TYPE]:    'Rooms with a {objTypeALower} must not also contain a {objTypeBLower}.',
  // Funky
  [CType.MORE_WARM_THAN_COOL]:    'There must be more warm-colored objects than cool-colored objects in the house.',
  [CType.MORE_COOL_THAN_WARM]:    'There must be more cool-colored objects than warm-colored objects in the house.',
  [CType.WALL_MATCHES_OBJECT]:    'Every room must contain at least one object matching its wall color.',
  [CType.NO_WALL_MATCHES_OBJECT]: 'No room may contain an object matching its wall color.',
  [CType.COLOR_EXCLUSION_ZONE]:   'No two {color} rooms may both contain a {objTypeLower}.',
  // Quantity comparison
  [CType.MORE_OBJ_COLOR_THAN_STYLE]:           'There must be more {color} objects than {styleLower} objects in the house.',
  [CType.MORE_OBJ_STYLE_THAN_COLOR]:           'There must be more {styleLower} objects than {color} objects in the house.',
  [CType.MORE_TYPE_IN_AREA_THAN_TYPE_IN_AREA]: 'There must be more {objTypeAPlural} {areaA} than {objTypeBPlural} {areaB}.',
  [CType.MORE_COLOR_THAN_COLOR]:               'There must be more {colorA} objects than {colorB} objects in the house.',
};

const VOICE_PREFIXES = {
  formal:     ['It is essential that ', 'I insist that ', 'I require that ', 'It is important that '],
  casual:     ["I'd really like ", "I'd love for ", 'I want ', "I'd prefer for "],
  passionate: ['I absolutely need ', 'I really, really need ', 'I desperately want ', "It's vital to me for "],
  neutral:    [''],
};

function transformVoice(text, voice) {
  let core = text.replace(/\.$/, '');
  core = core[0].toLowerCase() + core.slice(1);
  if (voice === 'formal') {
    core = core.replace(/\bmust not\b/g, 'not').replace(/\bmust\b/g, '').replace(/\bmay not\b/g, 'not').replace(/\bmay\b/g, '');
    core = core.replace(/ {2,}/g, ' ');
  } else {
    core = core.replace(/\bmust not\b/g, 'not to').replace(/\bmust\b/g, 'to').replace(/\bmay not\b/g, 'not to').replace(/\bmay\b/g, 'to');
  }
  return core;
}

function renderNL(rng, c, voice = 'neutral') {
  const tpl = NL[c.ctype] || `[${c.ctype}]`;
  const p = c.params;
  const subs = {
    room: p.room || '', area: p.area || '', color: p.color || '',
    colorA: p.colorA || '', colorB: p.colorB || '',
    n: p.n != null ? String(p.n) : '',
    objTypeLower: p.objType ? p.objType.toLowerCase() : '',
    objTypePlural: p.objType ? OBJ_PLURAL[p.objType] : '',
    objTypeALower: p.objTypeA ? p.objTypeA.toLowerCase() : '',
    objTypeBLower: p.objTypeB ? p.objTypeB.toLowerCase() : '',
    objTypeAPlural: p.objTypeA ? OBJ_PLURAL[p.objTypeA] : '',
    objTypeBPlural: p.objTypeB ? OBJ_PLURAL[p.objTypeB] : '',
    styleLower: p.style ? p.style.toLowerCase() : '',
    styleALower: p.styleA ? p.styleA.toLowerCase() : '',
    styleBLower: p.styleB ? p.styleB.toLowerCase() : '',
    wallColor: p.wallColor || '',
    objColor: p.objColor || '',
    areaA: p.areaA || '', areaB: p.areaB || '',
    roomWord: p.n === 1 ? 'room' : 'rooms',
    objWord: p.n === 1 ? 'object' : 'objects',
  };
  let text = tpl.replace(/\{(\w+)\}/g, (_, k) => subs[k] !== undefined ? subs[k] : `{${k}}`);

  if (voice !== 'neutral') {
    const prefixes = VOICE_PREFIXES[voice] || [''];
    const prefix = rng.choice(prefixes);
    if (prefix) text = prefix + transformVoice(text, voice) + '.';
  }
  return text;
}

// ================================================================
// SECTION 7: FINAL STATE GENERATION
// ================================================================

function generateFinalState(rng, numPlayers, params) {
  const state = new HouseState(numPlayers);
  const colorsUsed = rng.sample(COLORS, Math.min(params.numColors, 4));
  const stylesUsed = rng.sample(STYLES, Math.min(params.numStyles, 4));

  // Wall colors (at least 2 distinct)
  let wallColors;
  for (let a = 0; a < 100; a++) {
    wallColors = state.roomNames.map(() => rng.choice(colorsUsed));
    if (new Set(wallColors).size >= 2) break;
  }
  state.roomNames.forEach((rn, i) => { state.rooms[rn].wallColor = wallColors[i]; });

  // Place objects
  const [minI, maxI] = params.totalItems;
  const target = rng.randint(minI, maxI);
  let allSlots = rng.shuffle(state.roomNames.flatMap(rn => OBJECT_TYPES.map(ot => [rn, ot])));
  const themeOt = rng.random() < 0.4 ? rng.choice(OBJECT_TYPES) : null;
  const themeSt = themeOt ? rng.choice(stylesUsed) : null;
  let placed = 0;
  for (const [rn, ot] of allSlots) {
    if (placed >= target) break;
    let style = rng.choice(stylesUsed);
    if (themeOt && ot === themeOt && rng.random() < 0.7) style = themeSt;
    else if (rng.random() < params.patternProb) {
      const wc = state.rooms[rn].wallColor;
      if (COLOR_TO_STYLE[ot] && COLOR_TO_STYLE[ot][wc]) {
        const cs = COLOR_TO_STYLE[ot][wc];
        if (stylesUsed.includes(cs)) style = cs;
      }
    }
    state.rooms[rn].setObject(ot, makeToken(ot, style));
    placed++;
  }

  // Ensure coverage
  for (const ot of OBJECT_TYPES) {
    if (state.countObjType(ot) === 0) {
      const empty = state.roomNames.filter(rn => !state.rooms[rn].getObject(ot));
      if (empty.length) state.rooms[rng.choice(empty)].setObject(ot, makeToken(ot, rng.choice(stylesUsed)));
    }
  }
  // Ensure style variety
  const allStyles = new Set(state.getAllObjects().map(o => o.style));
  if (allStyles.size < 2 && stylesUsed.length >= 2) {
    for (const rn of state.roomNames) {
      for (const ot of OBJECT_TYPES) {
        const obj = state.rooms[rn].getObject(ot);
        if (obj) {
          const others = stylesUsed.filter(s => s !== obj.style);
          if (others.length) { state.rooms[rn].setObject(ot, makeToken(ot, rng.choice(others))); return state; }
        }
      }
    }
  }
  return state;
}

// ================================================================
// SECTION 8: CONSTRAINT ASSIGNMENT
// ================================================================

const NEGATIVE_TYPES = new Set([
  CType.ROOM_WALL_COLOR_IS_NOT, CType.ROOM_NO_OBJECT_TYPE, CType.ROOM_NO_STYLE,
  CType.ROOM_NO_COLOR_OBJECT, CType.AREA_NO_OBJECT_TYPE, CType.AREA_NO_COLOR_OBJECT,
  CType.AREA_NO_STYLE, CType.NO_COLOR_OBJECTS_IN_HOUSE,
  // Spatial negative
  CType.DIAG_STYLE_NO_WALL_COLOR, CType.ADJ_STYLE_NO_WALL_COLOR,
  CType.ABOVE_STYLE_NO_WALL_COLOR, CType.BELOW_STYLE_NO_WALL_COLOR,
  CType.BESIDE_STYLE_NO_WALL_COLOR, CType.ADJ_ROOMS_DIFF_WALL,
  // Conditional negative
  CType.WALL_COLOR_FORBIDS_STYLE, CType.STYLE_PAIR_FORBIDDEN,
  CType.WALL_COLOR_FORBIDS_OBJ_COLOR, CType.OBJ_TYPE_FORBIDS_OBJ_TYPE,
  CType.NO_WALL_MATCHES_OBJECT, CType.COLOR_EXCLUSION_ZONE,
]);

const WARM_COOL_TYPES = new Set([
  CType.ROOM_WALL_WARM, CType.ROOM_WALL_COOL,
  CType.AT_LEAST_N_WARM_OBJECTS, CType.AT_LEAST_N_COOL_OBJECTS,
  CType.MORE_WARM_THAN_COOL, CType.MORE_COOL_THAN_WARM,
]);

function constraintKey(c) {
  return c.ctype + '::' + Object.entries(c.params).sort().map(([k, v]) => `${k}=${v}`).join(',');
}

function getReferencedRooms(c, layout) {
  const rooms = new Set();
  if (c.params.room) rooms.add(c.params.room);
  if (c.params.area && layout[c.params.area]) layout[c.params.area].forEach(r => rooms.add(r));
  if (c.params.areaA && layout[c.params.areaA]) layout[c.params.areaA].forEach(r => rooms.add(r));
  if (c.params.areaB && layout[c.params.areaB]) layout[c.params.areaB].forEach(r => rooms.add(r));
  return rooms;
}

function assignConstraints(rng, state, numPlayers, rulesPerPlayer, warmCoolBias = 1.0) {
  const allCands = generateCandidates(state);
  // Apply warm/cool bias multiplier
  for (const c of allCands) {
    if (WARM_COOL_TYPES.has(c.ctype)) c.score *= warmCoolBias;
  }
  // Deduplicate
  const candMap = new Map();
  for (const c of allCands) {
    const k = constraintKey(c);
    if (!candMap.has(k) || c.score > candMap.get(k).score) candMap.set(k, c);
  }
  const candidates = rng.shuffle([...candMap.values()]);
  candidates.sort((a, b) => b.score - a.score);

  const assignments = Array.from({ length: numPlayers }, () => []);
  const usedKeys = new Set();
  const pRooms = Array.from({ length: numPlayers }, () => new Set());
  const pTypes = Array.from({ length: numPlayers }, () => new Set());
  const pHasNeg = Array.from({ length: numPlayers }, () => false);
  const pHasPos = Array.from({ length: numPlayers }, () => false);
  const layout = state.layout;

  for (let round = 0; round < rulesPerPlayer; round++) {
    for (let pl = 0; pl < numPlayers; pl++) {
      if (assignments[pl].length >= rulesPerPlayer) continue;
      const eligible = candidates.filter(c => !usedKeys.has(constraintKey(c)));
      if (!eligible.length) break;
      const weights = eligible.map(c => {
        let sc = c.score;
        const refs = getReferencedRooms(c, layout);
        const newR = [...refs].filter(r => !pRooms[pl].has(r));
        if (newR.length) sc += 1.5;
        if (!pTypes[pl].has(c.ctype)) sc += 1.0;
        const isNeg = NEGATIVE_TYPES.has(c.ctype);
        if (isNeg && !pHasNeg[pl]) sc += 1.0;
        if (!isNeg && !pHasPos[pl]) sc += 1.0;
        if (refs.size && !newR.length && pRooms[pl].size >= 2) sc -= 2.0;
        if (pTypes[pl].has(c.ctype)) sc -= 1.5;
        return Math.max(sc, 0.1);
      });
      const idx = rng.weightedIndex(weights);
      if (idx < 0) break;
      const chosen = eligible[idx];
      assignments[pl].push(chosen);
      usedKeys.add(constraintKey(chosen));
      for (const r of getReferencedRooms(chosen, layout)) pRooms[pl].add(r);
      pTypes[pl].add(chosen.ctype);
      if (NEGATIVE_TYPES.has(chosen.ctype)) pHasNeg[pl] = true; else pHasPos[pl] = true;
    }
  }
  return assignments;
}

// ================================================================
// SECTION 9: PERTURBATION (Initial Board Generation)
// ================================================================

function moveKey(m) { return JSON.stringify(m); }

function inverseMove(m) {
  if (m.action === 'paint') return { action: 'paint', room: m.room, oldColor: m.newColor, newColor: m.oldColor };
  if (m.action === 'swap')  return { action: 'swap', room: m.room, objType: m.objType, oldStyle: m.newStyle, newStyle: m.oldStyle };
  if (m.action === 'remove') return { action: 'add', room: m.room, objType: m.objType, newStyle: m.oldStyle };
  if (m.action === 'add')    return { action: 'remove', room: m.room, objType: m.objType, oldStyle: m.newStyle };
  throw new Error(`Unknown action: ${m.action}`);
}

function describeMove(m) {
  if (m.action === 'paint') return `Paint ${m.room}: ${m.oldColor} -> ${m.newColor}`;
  if (m.action === 'swap') {
    const oc = STYLE_TO_COLOR[m.objType][m.oldStyle], nc = STYLE_TO_COLOR[m.objType][m.newStyle];
    return `Swap ${m.oldStyle} ${oc} ${m.objType} -> ${m.newStyle} ${nc} ${m.objType} in ${m.room}`;
  }
  if (m.action === 'remove') { const c = STYLE_TO_COLOR[m.objType][m.oldStyle]; return `Remove ${m.oldStyle} ${c} ${m.objType} from ${m.room}`; }
  if (m.action === 'add') { const c = STYLE_TO_COLOR[m.objType][m.newStyle]; return `Add ${m.newStyle} ${c} ${m.objType} to ${m.room}`; }
  return JSON.stringify(m);
}

function applyMove(state, m) {
  if (m.action === 'paint') state.paintRoom(m.room, m.newColor);
  else if (m.action === 'swap') state.swapObject(m.room, makeToken(m.objType, m.newStyle));
  else if (m.action === 'remove') state.removeObject(m.room, m.objType);
  else if (m.action === 'add') state.addObject(m.room, makeToken(m.objType, m.newStyle));
}

function listAllMoves(state, allowedTypes) {
  const moves = [];
  for (const rn of state.roomNames) {
    const room = state.rooms[rn];
    if (allowedTypes.includes('paint'))
      for (const c of COLORS) if (c !== room.wallColor) moves.push({ action: 'paint', room: rn, oldColor: room.wallColor, newColor: c });
    if (allowedTypes.includes('swap'))
      for (const ot of OBJECT_TYPES) { const obj = room.getObject(ot); if (obj) for (const st of STYLES) if (st !== obj.style) moves.push({ action: 'swap', room: rn, objType: ot, oldStyle: obj.style, newStyle: st }); }
    if (allowedTypes.includes('remove'))
      for (const ot of OBJECT_TYPES) { const obj = room.getObject(ot); if (obj) moves.push({ action: 'remove', room: rn, objType: ot, oldStyle: obj.style }); }
    if (allowedTypes.includes('add'))
      for (const ot of OBJECT_TYPES) if (!room.getObject(ot)) for (const st of STYLES) moves.push({ action: 'add', room: rn, objType: ot, newStyle: st });
  }
  return moves;
}

function countViolations(state, assignments) {
  return assignments.map(rules => rules.filter(r => !evalC(r, state)).length);
}

function generateInitialState(rng, solution, assignments, config) {
  const { numPerturbations = 6, minViolPerPlayer = 1, allowedTypes = ['paint', 'swap', 'remove', 'add'],
    typeWeights = { paint: 1.0, swap: 1.5, remove: 0.8, add: 0.3 }, maxAttempts = 30 } = config;

  let bestState = null, bestMoves = null, bestScore = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const state = solution.deepCopy();
    const visited = new Set([state.fingerprint()]);
    const moves = [];
    let lastMove = null;

    // Phase 1: random walk
    for (let step = 0; step < numPerturbations; step++) {
      const candidates = rng.shuffle(listAllMoves(state, allowedTypes));
      const weights = candidates.map(m => typeWeights[m.action] || 1.0);
      let found = false;
      const tried = new Set();
      const wCopy = [...weights]; const cCopy = [...candidates];
      while (cCopy.length) {
        const total = wCopy.reduce((a, b) => a + b, 0);
        if (total <= 0) break;
        let r = rng.random() * total, idx = 0;
        for (let i = 0; i < wCopy.length; i++) { r -= wCopy[i]; if (r <= 0) { idx = i; break; } }
        const move = cCopy.splice(idx, 1)[0]; wCopy.splice(idx, 1);
        if (lastMove && moveKey(move) === moveKey(inverseMove(lastMove))) continue;
        applyMove(state, move);
        const fp = state.fingerprint();
        if (visited.has(fp)) { applyMove(state, inverseMove(move)); continue; }
        visited.add(fp); moves.push(move); lastMove = move; found = true; break;
      }
      if (!found) break;
    }

    // Phase 2: targeted violation fix
    for (let extra = 0; extra < 10; extra++) {
      const viols = countViolations(state, assignments);
      if (viols.every(v => v >= minViolPerPlayer)) break;
      const under = [];
      viols.forEach((v, i) => { if (v < minViolPerPlayer) under.push(i); });
      if (!under.length) break;
      const pl = rng.choice(under);
      const satisfied = assignments[pl].filter(r => evalC(r, state));
      rng.shuffle(satisfied);
      let fixed = false;
      for (const target of satisfied) {
        const candidates = rng.shuffle(listAllMoves(state, allowedTypes));
        for (const move of candidates) {
          if (moves.length && moveKey(move) === moveKey(inverseMove(moves[moves.length - 1]))) continue;
          applyMove(state, move);
          const fp = state.fingerprint();
          if (!visited.has(fp) && !evalC(target, state)) { visited.add(fp); moves.push(move); fixed = true; break; }
          applyMove(state, inverseMove(move));
        }
        if (fixed) break;
      }
    }

    const viols = countViolations(state, assignments);
    const score = viols.filter(v => v >= minViolPerPlayer).length;
    if (score > bestScore) { bestState = state; bestMoves = moves; bestScore = score; }
    if (score === assignments.length) break;
  }
  return { state: bestState, moves: bestMoves };
}

// ================================================================
// SECTION 10: TOP-LEVEL SCENARIO GENERATION
// ================================================================

const PLAYER_VOICES = ['formal', 'casual', 'passionate', 'neutral', 'formal'];

function generateScenario({ numPlayers = 2, difficulty = 'medium', seed = null, perturbation = {}, warmCoolBias } = {}) {
  const params = DIFFICULTY_PARAMS[difficulty] || DIFFICULTY_PARAMS.medium;
  const wcBias = warmCoolBias != null ? warmCoolBias : params.warmCoolBias;
  const rng1 = new SeededRandom(seed);
  const solution = generateFinalState(rng1, numPlayers, params);
  const assignments = assignConstraints(new SeededRandom(seed), solution, numPlayers, params.rulesPerPlayer, wcBias);

  const [lo, hi] = params.pertRange;
  const pertConfig = {
    numPerturbations: perturbation.numPerturbations || new SeededRandom(seed != null ? seed * 2 : undefined).randint(lo, hi),
    minViolPerPlayer: perturbation.minViolPerPlayer != null ? perturbation.minViolPerPlayer : 1,
    allowedTypes: perturbation.allowedTypes || ['paint', 'swap', 'remove', 'add'],
    typeWeights: perturbation.typeWeights || params.pertWeights,
    maxAttempts: perturbation.maxAttempts || 30,
  };
  const rng2 = new SeededRandom(seed != null ? seed * 3 + 7 : undefined);
  const { state: initial, moves } = generateInitialState(rng2, solution, assignments, pertConfig);

  const players = assignments.map((rules, i) => {
    const voice = PLAYER_VOICES[i % PLAYER_VOICES.length];
    const nlRng = new SeededRandom(seed != null ? seed * 5 + i : undefined);
    const constraints = rules.map(r => ({
      text: renderNL(nlRng, r, voice),
    }));
    return { id: i + 1, voice, constraints };
  });

  return {
    numPlayers, difficulty,
    initialBoard: initial.serialize(),
    solutionBoard: solution.serialize(),
    players,
    perturbationLog: moves.map(describeMove),
  };
}

module.exports = { generateScenario, DIFFICULTY_PARAMS };
