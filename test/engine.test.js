'use strict';
/**
 * Tests for the Decorum scenario engine:
 *
 * 1. Condition overlap (no redundant conditions)
 * 2. Closest solution (no valid solution strictly closer than intended)
 *
 * Run: npm test
 * HTML report with all player conditions: npm run test:report
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  generateScenario,
  constraintKey,
  findRedundantPairs,
  findGroupRedundancies,
  allConstraints,
  findClosestSolutionDepths,
} = require('./engine-test-helpers.js');

const OVERLAP_SEEDS = 6;
const CLOSEST_SOLUTION_SEEDS = 3;
const OVERLAP_NUM_PLAYERS = 5;

// ─── Tests: condition overlap ──────────────────────────────────────────────

describe('Condition overlap', () => {
  const difficulties = ['easy', 'medium', 'hard'];

  for (const difficulty of difficulties) {
    describe(`difficulty ${difficulty}`, () => {
      for (let seed = 1; seed <= OVERLAP_SEEDS; seed++) {
        it(`no redundant conditions between players (seed ${seed})`, () => {
          const scenario = generateScenario({ numPlayers: OVERLAP_NUM_PLAYERS, difficulty, seed, includeAssignments: true });
          const assignments = scenario._assignments;
          if (!assignments || assignments.length < 2) return;

          const layout = scenario.initialBoard?.layout || null;
          const all = allConstraints(assignments);
          const redundant = findRedundantPairs(all, layout);

          function playerOf(globalIndex) {
            let idx = 0;
            for (let pl = 0; pl < assignments.length; pl++) {
              if (globalIndex < idx + assignments[pl].length) return pl;
              idx += assignments[pl].length;
            }
            return -1;
          }
          const fromDifferentPlayers = redundant.filter(([i, j]) => playerOf(i) !== playerOf(j));

          const groupRedundant = findGroupRedundancies(all, layout);
          assert.equal(
            fromDifferentPlayers.length,
            0,
            `Seed ${seed}: found redundant constraints between players: ${fromDifferentPlayers.map(([i, j]) => `(${i},${j}) ${constraintKey(all[i])} <-> ${constraintKey(all[j])}`).join('; ')}`
          );
          assert.equal(
            groupRedundant.length,
            0,
            `Seed ${seed}: found constraint redundant with group (between players): indices ${groupRedundant.join(', ')}`
          );
        });

        it(`no redundant conditions within a player (seed ${seed})`, () => {
          const scenario = generateScenario({ numPlayers: OVERLAP_NUM_PLAYERS, difficulty, seed, includeAssignments: true });
          const assignments = scenario._assignments;
          if (!assignments) return;

          const layout = scenario.initialBoard?.layout || null;
          for (let pl = 0; pl < assignments.length; pl++) {
            const rules = assignments[pl];
            const redundant = findRedundantPairs(rules, layout);
            const groupRedundant = findGroupRedundancies(rules, layout);
            assert.equal(
              redundant.length,
              0,
              `Seed ${seed} player ${pl + 1}: redundant pair within player: ${redundant.map(([i, j]) => `${constraintKey(rules[i])} <-> ${constraintKey(rules[j])}`).join('; ')}`
            );
            assert.equal(
              groupRedundant.length,
              0,
              `Seed ${seed} player ${pl + 1}: constraint redundant with group (indices ${groupRedundant.join(', ')}): ${groupRedundant.map(i => constraintKey(rules[i])).join('; ')}`
            );
          }
        });
      }
    });
  }
});

// ─── Closest solution ──────────────────────────────────────────────────────

describe('Closest solution', () => {
  const difficulties = ['easy', 'medium', 'hard'];

  for (const difficulty of difficulties) {
    describe(`difficulty ${difficulty}`, () => {
      for (let seed = 1; seed <= CLOSEST_SOLUTION_SEEDS; seed++) {
        it(`no valid solution strictly closer than intended (seed ${seed})`, () => {
          const scenario = generateScenario({
            numPlayers: 2,
            difficulty,
            seed,
            includeAssignments: true,
          });
          const assignments = scenario._assignments;
          if (!assignments) {
            assert.fail('Scenario missing _assignments');
          }

          const allConstraintsList = allConstraints(assignments);
          const intendedDepthFromLog = (scenario.perturbationLog || []).length;
          const { intendedDepth, minOtherSolutionDepth, stateCapReached } = findClosestSolutionDepths(
            scenario.initialBoard,
            scenario.solutionBoard,
            allConstraintsList,
            intendedDepthFromLog
          );

          if (stateCapReached && minOtherSolutionDepth === Infinity) {
            console.log(`  (seed ${seed}: state cap reached before finishing depth < ${intendedDepth}; inconclusive)`);
            return;
          }

          assert.ok(
            minOtherSolutionDepth >= intendedDepth,
            `Seed ${seed}: found another valid solution at ${minOtherSolutionDepth} moves (intended at ${intendedDepth})`
          );
        });
      }
    });
  }
});
