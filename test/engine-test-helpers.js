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
  constraintKey: engineConstraintKey,
  constraintsRedundant: engineConstraintsRedundant,
  findGroupRedundancies: engineFindGroupRedundancies,
} = require('../src/engine.js');

const ALLOWED_MOVES = ['paint', 'swap', 'remove', 'add'];
const MAX_BFS_DEPTH = 15;
const MAX_BFS_STATES = 150000;

function constraintKey(c) {
  return engineConstraintKey(c);
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

function findRedundantPairs(constraints, layout) {
  const pairs = [];
  for (let i = 0; i < constraints.length; i++) {
    for (let j = i + 1; j < constraints.length; j++) {
      if (engineConstraintsRedundant(constraints[i], constraints[j], layout)) pairs.push([i, j]);
    }
  }
  return pairs;
}

function findGroupRedundancies(constraints, layout) {
  return engineFindGroupRedundancies(constraints, layout);
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
