'use strict';
/**
 * Shared helpers for engine tests and HTML report.
 * Used by engine.test.js and run-tests-with-report.js.
 */
const {
  generateScenario,
  HouseState,
  evalC,
  listAllMoves,
  applyMove,
} = require('../src/engine.js');

const ALLOWED_MOVES = ['paint', 'swap', 'remove', 'add'];
const MAX_BFS_DEPTH = 15;
const MAX_BFS_STATES = 150000;

function constraintKey(c) {
  const p = c.params || {};
  const ctype = (c.ctype || '').toString();
  const parts = Object.keys(p).sort().map(k => `${k}=${normalizeParamValue(p[k])}`);
  return ctype + '::' + parts.join(',');
}

function normalizeParamValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  return String(v);
}

function constraintsEquivalent(c1, c2) {
  return constraintKey(c1) === constraintKey(c2);
}

function roomInArea(room, area, layout) {
  if (!layout || !layout[area]) return false;
  return layout[area].includes(room);
}

function areaIsSingleRoom(area, layout) {
  return layout && Array.isArray(layout[area]) && layout[area].length === 1;
}

function constraintsRedundant(c1, c2, layout) {
  if (constraintsEquivalent(c1, c2)) return true;

  const t1 = c1.ctype, t2 = c2.ctype;
  const p1 = c1.params || {}, p2 = c2.params || {};

  if (t1 === 'NO_COLOR_OBJECTS_IN_HOUSE' && p1.color) {
    if (t2 === 'ROOM_NO_COLOR_OBJECT' && p2.color === p1.color) return true;
    if (t2 === 'AREA_NO_COLOR_OBJECT' && p2.color === p1.color) return true;
  }
  if (t2 === 'NO_COLOR_OBJECTS_IN_HOUSE' && p2.color) {
    if (t1 === 'ROOM_NO_COLOR_OBJECT' && p1.color === p2.color) return true;
    if (t1 === 'AREA_NO_COLOR_OBJECT' && p1.color === p2.color) return true;
  }

  if (layout) {
    if (t1 === 'AREA_NO_COLOR_OBJECT' && p1.area && p1.color) {
      const roomsInArea = layout[p1.area];
      if (Array.isArray(roomsInArea) && t2 === 'ROOM_NO_COLOR_OBJECT' && p2.room && p2.color === p1.color && roomsInArea.includes(p2.room)) return true;
    }
    if (t2 === 'AREA_NO_COLOR_OBJECT' && p2.area && p2.color) {
      const roomsInArea = layout[p2.area];
      if (Array.isArray(roomsInArea) && t1 === 'ROOM_NO_COLOR_OBJECT' && p1.room && p1.color === p2.color && roomsInArea.includes(p1.room)) return true;
    }
    if (t1 === 'AREA_NO_STYLE' && p1.area && p1.style) {
      const roomsInArea = layout[p1.area];
      if (Array.isArray(roomsInArea) && t2 === 'ROOM_NO_STYLE' && p2.room && p2.style === p1.style && roomsInArea.includes(p2.room)) return true;
    }
    if (t2 === 'AREA_NO_STYLE' && p2.area && p2.style) {
      const roomsInArea = layout[p2.area];
      if (Array.isArray(roomsInArea) && t1 === 'ROOM_NO_STYLE' && p1.room && p1.style === p2.style && roomsInArea.includes(p1.room)) return true;
    }
    if (t1 === 'AREA_NO_OBJECT_TYPE' && p1.area && p1.objType) {
      const roomsInArea = layout[p1.area];
      if (Array.isArray(roomsInArea) && t2 === 'ROOM_NO_OBJECT_TYPE' && p2.room && p2.objType === p1.objType && roomsInArea.includes(p2.room)) return true;
    }
    if (t2 === 'AREA_NO_OBJECT_TYPE' && p2.area && p2.objType) {
      const roomsInArea = layout[p2.area];
      if (Array.isArray(roomsInArea) && t1 === 'ROOM_NO_OBJECT_TYPE' && p1.room && p1.objType === p2.objType && roomsInArea.includes(p1.room)) return true;
    }

    if (t1 === 'ROOM_HAS_OBJECT_TYPE' && p1.room && p1.objType && t2 === 'AREA_HAS_OBJECT_TYPE' && p2.area && p2.objType === p1.objType && roomInArea(p1.room, p2.area, layout)) return true;
    if (t2 === 'ROOM_HAS_OBJECT_TYPE' && p2.room && p2.objType && t1 === 'AREA_HAS_OBJECT_TYPE' && p1.area && p1.objType === p2.objType && roomInArea(p2.room, p1.area, layout)) return true;
    if (t1 === 'ROOM_HAS_COLOR_OBJECT' && p1.room && p1.color && t2 === 'AREA_HAS_COLOR_OBJECT' && p2.area && p2.color === p1.color && roomInArea(p1.room, p2.area, layout)) return true;
    if (t2 === 'ROOM_HAS_COLOR_OBJECT' && p2.room && p2.color && t1 === 'AREA_HAS_COLOR_OBJECT' && p1.area && p1.color === p2.color && roomInArea(p2.room, p1.area, layout)) return true;
    if (t1 === 'ROOM_HAS_STYLE' && p1.room && p1.style && t2 === 'AREA_HAS_STYLE' && p2.area && p2.style === p1.style && roomInArea(p1.room, p2.area, layout)) return true;
    if (t2 === 'ROOM_HAS_STYLE' && p2.room && p2.style && t1 === 'AREA_HAS_STYLE' && p1.area && p1.style === p2.style && roomInArea(p2.room, p1.area, layout)) return true;

    if (areaIsSingleRoom(p1.area, layout) && p1.area && layout[p1.area][0] === p2.room) {
      if (t1 === 'AREA_HAS_OBJECT_TYPE' && t2 === 'ROOM_HAS_OBJECT_TYPE' && p1.objType === p2.objType) return true;
      if (t1 === 'AREA_HAS_COLOR_OBJECT' && t2 === 'ROOM_HAS_COLOR_OBJECT' && p1.color === p2.color) return true;
      if (t1 === 'AREA_HAS_STYLE' && t2 === 'ROOM_HAS_STYLE' && p1.style === p2.style) return true;
      if (t1 === 'AREA_NO_OBJECT_TYPE' && t2 === 'ROOM_NO_OBJECT_TYPE' && p1.objType === p2.objType) return true;
      if (t1 === 'AREA_NO_COLOR_OBJECT' && t2 === 'ROOM_NO_COLOR_OBJECT' && p1.color === p2.color) return true;
      if (t1 === 'AREA_NO_STYLE' && t2 === 'ROOM_NO_STYLE' && p1.style === p2.style) return true;
    }
    if (areaIsSingleRoom(p2.area, layout) && p2.area && layout[p2.area][0] === p1.room) {
      if (t2 === 'AREA_HAS_OBJECT_TYPE' && t1 === 'ROOM_HAS_OBJECT_TYPE' && p2.objType === p1.objType) return true;
      if (t2 === 'AREA_HAS_COLOR_OBJECT' && t1 === 'ROOM_HAS_COLOR_OBJECT' && p2.color === p1.color) return true;
      if (t2 === 'AREA_HAS_STYLE' && t1 === 'ROOM_HAS_STYLE' && p2.style === p1.style) return true;
      if (t2 === 'AREA_NO_OBJECT_TYPE' && t1 === 'ROOM_NO_OBJECT_TYPE' && p2.objType === p1.objType) return true;
      if (t2 === 'AREA_NO_COLOR_OBJECT' && t1 === 'ROOM_NO_COLOR_OBJECT' && p2.color === p1.color) return true;
      if (t2 === 'AREA_NO_STYLE' && t1 === 'ROOM_NO_STYLE' && p2.style === p1.style) return true;
    }
  }

  if (t1 === 'ROOM_HAS_OBJECT_TYPE' && p1.objType && t2 === 'AT_LEAST_N_OBJECT_TYPE' && p2.objType === p1.objType && p2.n === 1) return true;
  if (t2 === 'ROOM_HAS_OBJECT_TYPE' && p2.objType && t1 === 'AT_LEAST_N_OBJECT_TYPE' && p1.objType === p2.objType && p1.n === 1) return true;
  if (t1 === 'ROOM_HAS_COLOR_OBJECT' && p1.color && t2 === 'AT_LEAST_N_COLOR_OBJECTS' && p2.color === p1.color && p2.n === 1) return true;
  if (t2 === 'ROOM_HAS_COLOR_OBJECT' && p2.color && t1 === 'AT_LEAST_N_COLOR_OBJECTS' && p1.color === p2.color && p1.n === 1) return true;
  if (t1 === 'ROOM_HAS_STYLE' && p1.style && t2 === 'AT_LEAST_N_STYLE_OBJECTS' && p2.style === p1.style && p2.n === 1) return true;
  if (t2 === 'ROOM_HAS_STYLE' && p2.style && t1 === 'AT_LEAST_N_STYLE_OBJECTS' && p1.style === p2.style && p1.n === 1) return true;

  if (t1 === 'EXACTLY_N_ROOMS_COLOR' && p1.n === 0 && p1.color && t2 === 'ROOM_WALL_COLOR_IS_NOT' && p2.color === p1.color) return true;
  if (t2 === 'EXACTLY_N_ROOMS_COLOR' && p2.n === 0 && p2.color && t1 === 'ROOM_WALL_COLOR_IS_NOT' && p1.color === p2.color) return true;

  // Area "has at least one X" implies house "at least 1 X" (area is stronger; house count is redundant)
  if (t1 === 'AREA_HAS_COLOR_OBJECT' && p1.area && p1.color && t2 === 'AT_LEAST_N_COLOR_OBJECTS' && p2.color === p1.color && p2.n === 1) return true;
  if (t2 === 'AREA_HAS_COLOR_OBJECT' && p2.area && p2.color && t1 === 'AT_LEAST_N_COLOR_OBJECTS' && p1.color === p2.color && p1.n === 1) return true;
  if (t1 === 'AREA_HAS_OBJECT_TYPE' && p1.area && p1.objType && t2 === 'AT_LEAST_N_OBJECT_TYPE' && p2.objType === p1.objType && p2.n === 1) return true;
  if (t2 === 'AREA_HAS_OBJECT_TYPE' && p2.area && p2.objType && t1 === 'AT_LEAST_N_OBJECT_TYPE' && p1.objType === p2.objType && p1.n === 1) return true;
  if (t1 === 'AREA_HAS_STYLE' && p1.area && p1.style && t2 === 'AT_LEAST_N_STYLE_OBJECTS' && p2.style === p1.style && p2.n === 1) return true;
  if (t2 === 'AREA_HAS_STYLE' && p2.area && p2.style && t1 === 'AT_LEAST_N_STYLE_OBJECTS' && p1.style === p2.style && p1.n === 1) return true;

  return false;
}

function allRoomNamesFromLayout(layout) {
  if (!layout || typeof layout !== 'object') return [];
  const set = new Set();
  for (const area of Object.keys(layout)) {
    const rooms = layout[area];
    if (Array.isArray(rooms)) rooms.forEach(r => set.add(r));
  }
  return [...set];
}

function findRedundantPairs(constraints, layout) {
  const pairs = [];
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      if (constraintsRedundant(constraints[i], constraints[j], layout)) pairs.push([i, j]);
    }
  }
  return pairs;
}

function findGroupRedundancies(constraints, layout) {
  const redundantIndices = [];
  const allRooms = allRoomNamesFromLayout(layout);

  for (let i = 0; i < constraints.length; i++) {
    const c = constraints[i];
    const t = c.ctype, p = c.params || {};

    if (t === 'NO_COLOR_OBJECTS_IN_HOUSE' && p.color && allRooms.length > 0) {
      const color = p.color;
      const hasNoColorInEveryRoom = allRooms.every(room =>
        constraints.some((c2, j) => j !== i && c2.ctype === 'ROOM_NO_COLOR_OBJECT' && c2.params?.room === room && c2.params?.color === color)
      );
      if (hasNoColorInEveryRoom) redundantIndices.push(i);
    }

    if (t === 'AT_LEAST_N_OBJECT_TYPE' && p.objType != null && p.n != null) {
      const roomsWith = new Set(
        constraints.filter((c2, j) => j !== i && c2.ctype === 'ROOM_HAS_OBJECT_TYPE' && c2.params?.objType === p.objType).map(c2 => c2.params?.room).filter(Boolean)
      );
      if (roomsWith.size >= p.n) redundantIndices.push(i);
    }

    if (t === 'AT_LEAST_N_COLOR_OBJECTS' && p.color != null && p.n != null) {
      const roomsWith = new Set(
        constraints.filter((c2, j) => j !== i && c2.ctype === 'ROOM_HAS_COLOR_OBJECT' && c2.params?.color === p.color).map(c2 => c2.params?.room).filter(Boolean)
      );
      if (roomsWith.size >= p.n) redundantIndices.push(i);
    }

    if (t === 'AT_LEAST_N_STYLE_OBJECTS' && p.style != null && p.n != null) {
      const roomsWith = new Set(
        constraints.filter((c2, j) => j !== i && c2.ctype === 'ROOM_HAS_STYLE' && c2.params?.style === p.style).map(c2 => c2.params?.room).filter(Boolean)
      );
      if (roomsWith.size >= p.n) redundantIndices.push(i);
    }
  }
  return redundantIndices;
}

function allConstraints(assignments) {
  return (assignments || []).flat();
}

function findClosestSolutionDepths(initialBoard, solutionBoard, allConstraintsList, intendedDepthFromLog, stateCap = MAX_BFS_STATES) {
  const initial = HouseState.deserialize(initialBoard);
  const solution = HouseState.deserialize(solutionBoard);
  const solutionFp = solution.fingerprint();
  const intendedDepth = intendedDepthFromLog;

  let minOtherSolutionDepth = Infinity;
  let stateCapReached = false;
  const maxDepth = Math.min(intendedDepth - 1, MAX_BFS_DEPTH);

  if (maxDepth < 0) {
    return { intendedDepth, minOtherSolutionDepth: Infinity, stateCapReached: false };
  }

  const visited = new Set();
  const queue = [{ state: initial, depth: 0 }];
  visited.add(initial.fingerprint());

  while (queue.length > 0 && visited.size <= stateCap) {
    const { state, depth } = queue.shift();
    if (depth > maxDepth) continue;

    const satisfiesAll = allConstraintsList.every(c => evalC(c, state));
    if (satisfiesAll) {
      const fp = state.fingerprint();
      if (fp !== solutionFp && depth < minOtherSolutionDepth) minOtherSolutionDepth = depth;
    }

    const moves = listAllMoves(state, ALLOWED_MOVES);
    for (const move of moves) {
      const next = state.deepCopy();
      applyMove(next, move);
      const nextFp = next.fingerprint();
      if (visited.has(nextFp)) continue;
      visited.add(nextFp);
      queue.push({ state: next, depth: depth + 1 });
      if (visited.size > stateCap) {
        stateCapReached = true;
        break;
      }
    }
  }

  return { intendedDepth, minOtherSolutionDepth, stateCapReached };
}

module.exports = {
  generateScenario,
  constraintKey,
  findRedundantPairs,
  findGroupRedundancies,
  allConstraints,
  findClosestSolutionDepths,
  ALLOWED_MOVES,
  MAX_BFS_DEPTH,
  MAX_BFS_STATES,
};
