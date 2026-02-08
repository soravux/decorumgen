/** Frontend logic for the Decorum scenario viewer (scenario.html) */
(function () {
  'use strict';

  const COLOR_CLASS = { Red: 'color-red', Yellow: 'color-yellow', Blue: 'color-blue', Green: 'color-green' };
  const WALL_CLASS  = { Red: 'wall-red', Yellow: 'wall-yellow', Blue: 'wall-blue', Green: 'wall-green' };
  const OBJ_LABELS  = { lamp: 'Lamp', wallHanging: 'Wall Hanging', curio: 'Curio' };

  // ── Extract token and player from URL ─────────────────────
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];
  const urlParams = new URLSearchParams(window.location.search);
  const selectedPlayer = urlParams.get('p') ? parseInt(urlParams.get('p')) : null;

  let scenarioData = null;
  let pollInterval = null;

  // ── Fetch scenario data ───────────────────────────────────
  async function loadScenario() {
    try {
      const res = await fetch(`/api/scenario/${token}`);
      if (!res.ok) {
        const err = await res.json();
        showError(err.error || 'Scenario not found');
        return;
      }
      scenarioData = await res.json();
      renderScenario(scenarioData);
    } catch (e) {
      showError('Failed to load scenario.');
    }
  }

  function showError(msg) {
    const el = document.getElementById('errorSection');
    el.textContent = msg;
    el.hidden = false;
  }

  // ── Render the complete scenario ──────────────────────────
  function renderScenario(data) {
    document.getElementById('scenarioInfo').textContent =
      `${data.numPlayers} players | ${data.difficulty} difficulty`;

    // Share URL
    const shareUrl = `${window.location.origin}/scenario/${token}`;
    document.getElementById('shareUrl').value = shareUrl;
    document.getElementById('shareSection').hidden = false;
    document.getElementById('copyBtn').addEventListener('click', () => {
      navigator.clipboard.writeText(shareUrl).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
      });
    });

    // Board
    renderBoard(data.initialBoard, 'houseGrid');
    document.getElementById('boardSection').hidden = false;

    if (selectedPlayer && selectedPlayer >= 1 && selectedPlayer <= data.numPlayers) {
      // Show this player's conditions with share buttons
      const player = data.players[selectedPlayer - 1];
      renderConditions(player, data.numPlayers);
      document.getElementById('condSection').hidden = false;

      // Show shared conditions section and start polling
      document.getElementById('sharedSection').hidden = false;
      refreshShares();
      pollInterval = setInterval(refreshShares, 5000);
    } else {
      // Show player picker
      renderPlayerPicker(data);
    }

    // Solution reveal
    document.getElementById('revealSection').hidden = false;
    document.getElementById('revealBtn').addEventListener('click', async () => {
      document.getElementById('revealBtn').hidden = true;
      try {
        const res = await fetch(`/api/scenario/${token}/solution`);
        const sol = await res.json();
        renderBoard(sol.solutionBoard, 'solutionGrid');
        const logEl = document.getElementById('pertLog');
        sol.perturbationLog.forEach(desc => {
          const li = document.createElement('li');
          li.textContent = desc;
          logEl.appendChild(li);
        });
        document.getElementById('solutionArea').hidden = false;
      } catch (e) {
        showError('Failed to load solution.');
      }
    });
  }

  // ── Render board ──────────────────────────────────────────
  function renderBoard(board, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const layout = board.layout;

    for (const [floorName, floorRooms] of [['Upstairs', layout.upstairs], ['Downstairs', layout.downstairs]]) {
      const label = document.createElement('div');
      label.className = 'floor-label';
      label.textContent = floorName;
      container.appendChild(label);

      for (const roomName of floorRooms) {
        const roomData = board.rooms.find(r => r.name === roomName);
        if (!roomData) continue;
        container.appendChild(createRoomCard(roomData));
      }
    }
  }

  function createRoomCard(room) {
    const card = document.createElement('div');
    card.className = `room-card ${WALL_CLASS[room.wallColor] || ''}`;

    const nameEl = document.createElement('div');
    nameEl.className = 'room-name';
    nameEl.textContent = room.name;
    card.appendChild(nameEl);

    const wallEl = document.createElement('div');
    wallEl.className = 'room-wall';
    wallEl.innerHTML = `<span class="wall-dot ${COLOR_CLASS[room.wallColor] || ''}"></span>${room.wallColor} walls`;
    card.appendChild(wallEl);

    for (const [key, label] of Object.entries(OBJ_LABELS)) {
      const obj = room[key];
      const el = document.createElement('div');
      if (obj) {
        el.className = 'room-obj';
        el.innerHTML = `<span class="obj-dot ${COLOR_CLASS[obj.color] || ''}"></span>${label}: ${obj.style} ${obj.color}`;
      } else {
        el.className = 'room-obj empty';
        el.textContent = `${label}: (empty)`;
      }
      card.appendChild(el);
    }
    return card;
  }

  // ── Render conditions with share buttons ──────────────────
  function renderConditions(player, numPlayers) {
    document.getElementById('condTitle').textContent =
      `Your Conditions - Player ${player.id}`;
    const list = document.getElementById('condList');
    list.innerHTML = '';

    player.constraints.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'cond-row';

      const num = document.createElement('span');
      num.className = 'cond-num';
      num.textContent = `${i + 1}.`;
      row.appendChild(num);

      const text = document.createElement('span');
      text.className = 'cond-text';
      text.textContent = c.text;
      row.appendChild(text);

      // Share buttons — one per other player
      const btns = document.createElement('span');
      btns.className = 'share-btns';
      for (let p = 1; p <= numPlayers; p++) {
        if (p === player.id) continue;
        const btn = document.createElement('button');
        btn.className = 'share-btn';
        btn.dataset.condIdx = i;
        btn.dataset.toPlayer = p;
        btn.textContent = `P${p}`;
        btn.title = `Share with Player ${p}`;
        btn.addEventListener('click', () => toggleShare(player.id, i, p, btn));
        btns.appendChild(btn);
      }
      row.appendChild(btns);
      list.appendChild(row);
    });
  }

  // ── Toggle sharing a condition ────────────────────────────
  async function toggleShare(fromPlayer, condIdx, toPlayer, btn) {
    try {
      btn.disabled = true;
      const res = await fetch(`/api/scenario/${token}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromPlayer, conditionIndex: condIdx, toPlayer }),
      });
      const data = await res.json();
      btn.classList.toggle('active', data.shared);
    } catch (e) {
      // silently fail
    } finally {
      btn.disabled = false;
    }
  }

  // ── Refresh shared conditions (poll) ──────────────────────
  async function refreshShares() {
    if (!selectedPlayer) return;
    try {
      const res = await fetch(`/api/scenario/${token}/shares/${selectedPlayer}`);
      const data = await res.json();

      // Update outgoing share button states
      document.querySelectorAll('.share-btn').forEach(btn => {
        const ci = parseInt(btn.dataset.condIdx);
        const tp = parseInt(btn.dataset.toPlayer);
        const sharedTo = data.sharedByYou && data.sharedByYou[ci];
        const isShared = sharedTo && sharedTo.includes(tp);
        if (!sharedTo || sharedTo.length === 0) {
          // Condition not shared with anyone: keep buttons unhighlighted
          btn.classList.remove('active');
        } else {
          btn.classList.toggle('active', isShared);
        }
      });

      // Update incoming shared conditions
      renderSharedConditions(data.sharedWithYou);
    } catch (e) {
      // silently fail
    }
  }

  function renderSharedConditions(sharedWithYou) {
    const container = document.getElementById('sharedList');
    if (!sharedWithYou || !sharedWithYou.length) {
      container.innerHTML = '<p class="empty-msg">No conditions shared with you yet.</p>';
      return;
    }

    // Group by fromPlayer
    const grouped = {};
    for (const s of sharedWithYou) {
      if (!grouped[s.fromPlayer]) grouped[s.fromPlayer] = [];
      grouped[s.fromPlayer].push(s.text);
    }

    container.innerHTML = '';
    for (const [from, texts] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.className = 'shared-from-header';
      header.textContent = `From Player ${from}:`;
      container.appendChild(header);
      for (const text of texts) {
        const item = document.createElement('div');
        item.className = 'shared-item';
        item.textContent = text;
        container.appendChild(item);
      }
    }
  }

  // ── Render player picker ──────────────────────────────────
  function renderPlayerPicker(data) {
    const grid = document.getElementById('pickGrid');
    grid.innerHTML = '';
    for (const player of data.players) {
      const btn = document.createElement('div');
      btn.className = 'player-pick-btn';
      btn.innerHTML = `<div class="pname">Player ${player.id}</div>`;
      btn.addEventListener('click', () => {
        window.location.href = `/scenario/${token}?p=${player.id}`;
      });
      grid.appendChild(btn);
    }
    document.getElementById('playerPicker').hidden = false;
  }

  // ── Init ──────────────────────────────────────────────────
  loadScenario();
})();
