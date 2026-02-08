'use strict';
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { generateScenario, DIFFICULTY_PARAMS } = require('./engine');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── In-memory scenario store ──────────────────────────────────
const store = new Map();

function genToken() {
  return crypto.randomBytes(6).toString('base64url');
}

// ── API Routes ────────────────────────────────────────────────

/** POST /api/generate — create a new scenario */
app.post('/api/generate', (req, res) => {
  try {
    const { numPlayers = 2, difficulty = 'medium', seed, perturbation } = req.body || {};
    const np = Math.min(4, Math.max(2, parseInt(numPlayers, 10) || 2));
    const diff = DIFFICULTY_PARAMS[difficulty] ? difficulty : 'medium';
    const s = seed != null ? parseInt(seed, 10) : null;

    const scenario = generateScenario({ numPlayers: np, difficulty: diff, seed: s, perturbation });
    scenario.shares = []; // mutable sharing state
    const token = genToken();
    store.set(token, scenario);

    // Expire after 24 hours
    setTimeout(() => store.delete(token), 24 * 60 * 60 * 1000);

    res.json({ token });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: 'Failed to generate scenario' });
  }
});

/** GET /api/scenario/:token — get scenario data (excludes solution) */
app.get('/api/scenario/:token', (req, res) => {
  const scenario = store.get(req.params.token);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  // Return everything except the solution board
  const { solutionBoard, ...safe } = scenario;
  res.json(safe);
});

/** GET /api/scenario/:token/solution — get solution (for reveal) */
app.get('/api/scenario/:token/solution', (req, res) => {
  const scenario = store.get(req.params.token);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
  res.json({
    solutionBoard: scenario.solutionBoard,
    perturbationLog: scenario.perturbationLog,
  });
});

/** POST /api/scenario/:token/share — toggle sharing a condition with another player */
app.post('/api/scenario/:token/share', (req, res) => {
  const scenario = store.get(req.params.token);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const { fromPlayer, conditionIndex, toPlayer } = req.body || {};
  if (fromPlayer == null || conditionIndex == null || toPlayer == null)
    return res.status(400).json({ error: 'Missing fromPlayer, conditionIndex, or toPlayer' });

  const fp = parseInt(fromPlayer), ci = parseInt(conditionIndex), tp = parseInt(toPlayer);
  const idx = scenario.shares.findIndex(s =>
    s.fromPlayer === fp && s.conditionIndex === ci && s.toPlayer === tp);

  if (idx >= 0) {
    scenario.shares.splice(idx, 1);
    res.json({ shared: false });
  } else {
    scenario.shares.push({ fromPlayer: fp, conditionIndex: ci, toPlayer: tp });
    res.json({ shared: true });
  }
});

/** GET /api/scenario/:token/shares/:player — get sharing state for a player */
app.get('/api/scenario/:token/shares/:player', (req, res) => {
  const scenario = store.get(req.params.token);
  if (!scenario) return res.status(404).json({ error: 'Scenario not found' });

  const pn = parseInt(req.params.player);

  // Conditions others have shared with this player
  const sharedWithYou = scenario.shares
    .filter(s => s.toPlayer === pn)
    .map(s => {
      const player = scenario.players[s.fromPlayer - 1];
      const cond = player && player.constraints[s.conditionIndex];
      return { fromPlayer: s.fromPlayer, text: cond ? cond.text : '(unknown)' };
    });

  // What this player has shared out: { conditionIndex -> [toPlayer, ...] }
  const sharedByYou = {};
  for (const s of scenario.shares) {
    if (s.fromPlayer === pn) {
      if (!sharedByYou[s.conditionIndex]) sharedByYou[s.conditionIndex] = [];
      sharedByYou[s.conditionIndex].push(s.toPlayer);
    }
  }

  res.json({ sharedWithYou, sharedByYou });
});

// ── Serve scenario.html for /scenario/:token routes ───────────
app.get('/scenario/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'scenario.html'));
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Decorum Scenario Generator running at http://localhost:${PORT}`);
});
