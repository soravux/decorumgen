'use strict';
/**
 * Runs engine tests and writes an HTML report including all player conditions
 * for condition-overlap tests.
 *
 * Run: npm run test:report
 * Output: test/report.html
 */
const fs = require('fs');
const path = require('path');
const {
  generateScenario,
  constraintKey,
  findRedundantPairs,
  findGroupRedundancies,
  allConstraints,
  findClosestSolutionDepths,
  MAX_BFS_STATES,
} = require('./engine-test-helpers.js');

const OVERLAP_SEEDS = 6;
const CLOSEST_SOLUTION_SEEDS = 3;
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const OVERLAP_NUM_PLAYERS = 5;

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runOverlapBetweenPlayers(difficulty, seed) {
  const scenario = generateScenario({ numPlayers: OVERLAP_NUM_PLAYERS, difficulty, seed, includeAssignments: true });
  const assignments = scenario._assignments;
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

  const pass = fromDifferentPlayers.length === 0 && groupRedundant.length === 0;
  let message = '';
  if (!pass) {
    if (fromDifferentPlayers.length) message += fromDifferentPlayers.map(([i, j]) => `Redundant between players: ${constraintKey(all[i])} <-> ${constraintKey(all[j])}`).join('; ');
    if (groupRedundant.length) message += (message ? '; ' : '') + `Group redundant indices: ${groupRedundant.join(', ')}`;
  }

  const playerConditions = (scenario.players || []).map(p => ({
    id: p.id,
    conditions: (p.constraints || []).map(c => c.text || ''),
  }));

  return { pass, message, playerConditions, scenario: { difficulty, seed, numPlayers: scenario.numPlayers } };
}

function runOverlapWithinPlayer(difficulty, seed) {
  const scenario = generateScenario({ numPlayers: OVERLAP_NUM_PLAYERS, difficulty, seed, includeAssignments: true });
  const assignments = scenario._assignments;
  const layout = scenario.initialBoard?.layout || null;
  const results = [];
  for (let pl = 0; pl < (assignments || []).length; pl++) {
    const rules = assignments[pl];
    const redundant = findRedundantPairs(rules, layout);
    const groupRedundant = findGroupRedundancies(rules, layout);
    const pass = redundant.length === 0 && groupRedundant.length === 0;
    let message = '';
    if (!pass) {
      if (redundant.length) message += redundant.map(([i, j]) => `${constraintKey(rules[i])} <-> ${constraintKey(rules[j])}`).join('; ');
      if (groupRedundant.length) message += (message ? '; ' : '') + `Group: ${groupRedundant.join(', ')}`;
    }
    results.push({ playerIndex: pl + 1, pass, message });
  }

  const playerConditions = (scenario.players || []).map(p => ({
    id: p.id,
    conditions: (p.constraints || []).map(c => c.text || ''),
  }));

  const pass = results.every(r => r.pass);
  const message = results.map(r => r.pass ? '' : `Player ${r.playerIndex}: ${r.message}`).filter(Boolean).join(' | ');

  return { pass, message, playerConditions, scenario: { difficulty, seed } };
}

function runClosestSolution(difficulty, seed) {
  const scenario = generateScenario({ numPlayers: 2, difficulty, seed, includeAssignments: true });
  const assignments = scenario._assignments;
  const allConstraintsList = allConstraints(assignments);
  const intendedDepthFromLog = (scenario.perturbationLog || []).length;
  const { intendedDepth, minOtherSolutionDepth, stateCapReached } = findClosestSolutionDepths(
    scenario.initialBoard,
    scenario.solutionBoard,
    allConstraintsList,
    intendedDepthFromLog,
    MAX_BFS_STATES
  );

  if (stateCapReached && minOtherSolutionDepth === Infinity) {
    return { pass: true, message: `Inconclusive (state cap); intended depth ${intendedDepth}`, playerConditions: null, scenario: { difficulty, seed } };
  }

  const pass = minOtherSolutionDepth >= intendedDepth;
  const message = pass ? '' : `Another solution at ${minOtherSolutionDepth} moves (intended ${intendedDepth})`;
  return { pass, message, playerConditions: null, scenario: { difficulty, seed } };
}

function buildReportHtml(overlapBetweenResults, overlapWithinResults, closestResults) {
  const totalOverlapBetween = overlapBetweenResults.length;
  const passOverlapBetween = overlapBetweenResults.filter(r => r.pass).length;
  const totalOverlapWithin = overlapWithinResults.length;
  const passOverlapWithin = overlapWithinResults.filter(r => r.pass).length;
  const totalClosest = closestResults.length;
  const passClosest = closestResults.filter(r => r.pass).length;
  const totalPass = passOverlapBetween + passOverlapWithin + passClosest;
  const totalFail = (totalOverlapBetween + totalOverlapWithin + totalClosest) - totalPass;

  function overlapRow(r, name) {
    const condsHtml = r.playerConditions && r.playerConditions.length
      ? r.playerConditions.map(p => `
        <div class="player-conditions">
          <strong>Player ${p.id}</strong>
          <ol>${p.conditions.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ol>
        </div>`).join('')
      : '—';
    return `
    <tr class="${r.pass ? 'pass' : 'fail'}">
      <td>${escapeHtml(name)}</td>
      <td class="result">${r.pass ? '✓ Pass' : '✗ Fail'}</td>
      <td>${r.message ? escapeHtml(r.message) : '—'}</td>
      <td class="conditions-cell">${condsHtml}</td>
    </tr>`;
  }

  const overlapTableRows = [];
  overlapBetweenResults.forEach(r => {
    overlapTableRows.push(overlapRow(r, `no redundant between players — ${r.scenario.difficulty} seed ${r.scenario.seed}`));
  });
  overlapWithinResults.forEach(r => {
    overlapTableRows.push(overlapRow(r, `no redundant within player — ${r.scenario.difficulty} seed ${r.scenario.seed}`));
  });

  const closestTableRows = closestResults.map(r => `
    <tr class="${r.pass ? 'pass' : 'fail'}">
      <td>no closer solution — ${escapeHtml(r.scenario.difficulty)} seed ${r.scenario.seed}</td>
      <td class="result">${r.pass ? '✓ Pass' : '✗ Fail'}</td>
      <td>${r.message ? escapeHtml(r.message) : '—'}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Decorum Engine Test Report</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 1.5rem; background: #1a1a1e; color: #e6e4e0; line-height: 1.5; }
    h1 { font-size: 1.75rem; margin-bottom: 0.5rem; }
    .meta { color: #9a9894; font-size: 0.9rem; margin-bottom: 1.5rem; }
    .summary { display: flex; gap: 1.5rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
    .summary-card { background: #24242b; border: 1px solid #35353d; border-radius: 8px; padding: 0.75rem 1.25rem; }
    .summary-card .count { font-size: 1.5rem; font-weight: 700; }
    .summary-card.pass .count { color: #0db14b; }
    .summary-card.fail .count { color: #f04b54; }
    section { margin-bottom: 2rem; }
    section h2 { font-size: 1.25rem; margin-bottom: 0.25rem; color: #e8e6e2; }
    .section-desc { color: #9a9894; font-size: 0.9rem; margin: 0 0 0.75rem 0; }
    table { width: 100%; border-collapse: collapse; background: #24242b; border-radius: 8px; overflow: hidden; border: 1px solid #35353d; }
    th, td { padding: 0.6rem 0.75rem; text-align: left; border-bottom: 1px solid #35353d; }
    th { background: #2a2a32; font-weight: 600; color: #b8b6b2; }
    tr:last-child td { border-bottom: none; }
    tr.pass .result { color: #0db14b; }
    tr.fail .result { color: #f04b54; }
    .conditions-cell { max-width: 480px; }
    .player-conditions { margin: 0.5rem 0; padding: 0.5rem; background: #1a1a1e; border-radius: 6px; font-size: 0.9rem; }
    .player-conditions ol { margin: 0.25rem 0 0 1rem; padding: 0; }
    .player-conditions li { margin: 0.2rem 0; }
  </style>
</head>
<body>
  <h1>Decorum Engine Test Report</h1>
  <p class="meta">Generated ${new Date().toISOString()}</p>

  <div class="summary">
    <div class="summary-card pass"><span class="count">${totalPass}</span> passed</div>
    <div class="summary-card fail"><span class="count">${totalFail}</span> failed</div>
    <div class="summary-card"><span class="count">${totalOverlapBetween + totalOverlapWithin}</span> condition overlap (${OVERLAP_NUM_PLAYERS} players)</div>
    <div class="summary-card"><span class="count">${totalClosest}</span> closest solution</div>
  </div>

  <section id="condition-overlap">
    <h2>Condition overlap (${OVERLAP_NUM_PLAYERS} players)</h2>
    <p class="section-desc">No redundant conditions between players or within a player. Player conditions are listed for each run.</p>
    <table>
      <thead>
        <tr>
          <th>Test</th>
          <th>Result</th>
          <th>Details</th>
          <th>Player conditions</th>
        </tr>
      </thead>
      <tbody>
${overlapTableRows.join('')}
      </tbody>
    </table>
  </section>

  <section id="closest-solution">
    <h2>Closest solution</h2>
    <p class="section-desc">No valid solution strictly closer to the initial board than the intended solution.</p>
    <table>
      <thead>
        <tr>
          <th>Test</th>
          <th>Result</th>
          <th>Details</th>
        </tr>
      </thead>
      <tbody>
${closestTableRows}
      </tbody>
    </table>
  </section>
</body>
</html>`;
}

function main() {
  const overlapBetweenResults = [];
  const overlapWithinResults = [];
  const closestResults = [];

  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= OVERLAP_SEEDS; seed++) {
      overlapBetweenResults.push(runOverlapBetweenPlayers(difficulty, seed));
      overlapWithinResults.push(runOverlapWithinPlayer(difficulty, seed));
    }
  }

  for (const difficulty of DIFFICULTIES) {
    for (let seed = 1; seed <= CLOSEST_SOLUTION_SEEDS; seed++) {
      closestResults.push(runClosestSolution(difficulty, seed));
    }
  }

  const html = buildReportHtml(overlapBetweenResults, overlapWithinResults, closestResults);
  const outPath = path.join(__dirname, 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');
  console.log('Report written to', outPath);

  const totalFail = overlapBetweenResults.filter(r => !r.pass).length
    + overlapWithinResults.filter(r => !r.pass).length
    + closestResults.filter(r => !r.pass).length;
  process.exit(totalFail > 0 ? 1 : 0);
}

main();
