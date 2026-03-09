/** Frontend logic for the Decorum scenario viewer (scenario.html) */
(function () {
  'use strict';

  const COLOR_CLASS = { Red: 'color-red', Yellow: 'color-yellow', Blue: 'color-blue', Green: 'color-green' };
  const WALL_CLASS  = { Red: 'wall-red', Yellow: 'wall-yellow', Blue: 'wall-blue', Green: 'wall-green' };
  const OBJ_LABELS  = { lamp: 'Lamp', wallHanging: 'Wall Hanging', curio: 'Curio' };
  const TYPE_TO_KEY = { 'Lamp': 'lamp', 'Wall Hanging': 'wallHanging', 'Curio': 'curio' };

  // Symbol SVG for styles/object types (order: longer phrases first)
  const TERM_SYMBOLS = [
    [/\b(wall hangings?)\b/gi, 'wall_hangings.svg'],
    [/\b(lamps?)\b/gi, 'lamps.svg'],
    [/\b(curios?)\b/gi, 'curios.svg'],
    [/\b(modern)\b/gi, 'modern.svg'],
    [/\b(antique)\b/gi, 'antique.svg'],
    [/\b(retro)\b/gi, 'retro.svg'],
    [/\b(unusual)\b/gi, 'unusual.svg'],
  ];

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /** Wraps color words (red, yellow, blue, green) in spans with matching text color. Run on escaped text. */
  function injectColorSpans(text) {
    return text.replace(/\b(red|yellow|blue|green)\b/gi, (match) =>
      '<span class="text-color text-color-' + match.toLowerCase() + '">' + match + '</span>');
  }

  /** Injects symbol img after each style/object-type mention, then color spans. Returns HTML string. */
  function injectTermSymbols(text) {
    let out = escapeHtml(text);
    out = injectColorSpans(out);
    for (const [pattern, symbol] of TERM_SYMBOLS) {
      out = out.replace(pattern, (match) => match + '<img src="/img/' + symbol + '" class="term-symbol" alt="">');
    }
    return out;
  }

  // ── Extract token and player from URL ─────────────────────
  const pathParts = window.location.pathname.split('/');
  const token = pathParts[pathParts.length - 1];
  const urlParams = new URLSearchParams(window.location.search);
  const selectedPlayer = urlParams.get('p') ? parseInt(urlParams.get('p')) : null;

  let scenarioData = null;
  let pollInterval = null;

  // ── Player names (server-synced via poll; localStorage fallback for initial load) ──────────────
  let serverPlayerNames = {};
  const NAMES_KEY = 'decorum-player-names-';

  function getPlayerNames() {
    return { ...serverPlayerNames };
  }

  function setPlayerName(playerId, name) {
    const trimmed = typeof name === 'string' ? name.trim().slice(0, 50) : '';
    serverPlayerNames[String(playerId)] = trimmed;
    try {
      const local = JSON.parse(localStorage.getItem(NAMES_KEY + token) || '{}');
      local[String(playerId)] = trimmed;
      localStorage.setItem(NAMES_KEY + token, JSON.stringify(local));
    } catch (e) { /* ignore */ }
  }

  /** Persist name to server so other clients see it; updates serverPlayerNames on success. */
  async function savePlayerNameToServer(playerId, name) {
    const trimmed = typeof name === 'string' ? name.trim().slice(0, 50) : '';
    try {
      const res = await fetch(`/api/scenario/${token}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, name: trimmed }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.playerNames) serverPlayerNames = { ...data.playerNames };
      }
    } catch (e) { /* ignore */ }
  }

  /** First 3 letters for share button label, or P1/P2 if no name. */
  function getShareButtonLabel(playerId) {
    const name = serverPlayerNames[String(playerId)];
    if (name && name.trim()) return name.trim().slice(0, 3);
    return 'P' + playerId;
  }

  /** Full display name for titles / "From X:". */
  function getPlayerDisplayName(playerId) {
    const name = serverPlayerNames[String(playerId)];
    if (name && name.trim()) return name.trim();
    return 'Player ' + playerId;
  }

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
      try {
        const raw = localStorage.getItem(NAMES_KEY + token);
        if (raw) serverPlayerNames = { ...serverPlayerNames, ...JSON.parse(raw) };
      } catch (e) { /* ignore */ }
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
      setupYourNameInput(selectedPlayer);
      renderConditions(player, data.numPlayers);
      document.getElementById('condSection').hidden = false;

      // Your name section (below share bar)
      document.getElementById('yourNameSection').hidden = false;

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
    const revealBtn = document.getElementById('revealBtn');
    const solutionArea = document.getElementById('solutionArea');
    const logEl = document.getElementById('pertLog');
    revealBtn.addEventListener('click', async () => {
      if (!solutionArea.hidden) {
        solutionArea.hidden = true;
        logEl.innerHTML = '';
        revealBtn.textContent = 'Reveal Solution';
        return;
      }
      revealBtn.disabled = true;
      try {
        const res = await fetch(`/api/scenario/${token}/solution`);
        const sol = await res.json();
        renderBoard(sol.solutionBoard, 'solutionGrid');
        logEl.innerHTML = '';
        sol.perturbationLog.forEach(desc => {
          const li = document.createElement('li');
          li.innerHTML = injectTermSymbols(desc);
          logEl.appendChild(li);
        });
        solutionArea.hidden = false;
        revealBtn.textContent = 'Hide Solution';
      } catch (e) {
        showError('Failed to load solution.');
      } finally {
        revealBtn.disabled = false;
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
    wallEl.innerHTML = `<span class="wall-dot ${COLOR_CLASS[room.wallColor] || ''}"></span>${injectColorSpans(escapeHtml(room.wallColor))} walls`;
    card.appendChild(wallEl);

    const objEntries = room.objects
      ? room.objects.map((item) => [TYPE_TO_KEY[item.type] || item.type, item.type, item])
      : Object.entries(OBJ_LABELS).map(([key, label]) => [key, label, room[key]]);
    for (const [key, label, obj] of objEntries) {
      const el = document.createElement('div');
      if (obj && obj.style && obj.color) {
        el.className = 'room-obj';
        el.innerHTML = `<span class="obj-dot ${COLOR_CLASS[obj.color] || ''}"></span>${injectTermSymbols(`${label}: ${obj.style} ${obj.color}`)}`;
      } else {
        el.className = 'room-obj empty';
        el.innerHTML = injectTermSymbols(`${label}: (empty)`);
      }
      card.appendChild(el);
    }
    return card;
  }

  function setupYourNameInput(currentPlayerId) {
    const input = document.getElementById('yourNameInput');
    input.placeholder = 'Player ' + currentPlayerId;
    input.value = serverPlayerNames[String(currentPlayerId)] || '';
    input.removeEventListener('input', input._nameHandler);
    input._nameHandler = () => {
      const name = input.value.trim();
      setPlayerName(currentPlayerId, name);
      savePlayerNameToServer(currentPlayerId, name);
      if (scenarioData && selectedPlayer) {
        const player = scenarioData.players[selectedPlayer - 1];
        renderConditions(player, scenarioData.numPlayers);
      }
    };
    input.addEventListener('input', input._nameHandler);
    input.addEventListener('blur', input._nameHandler);
  }

  // ── Render conditions with share buttons ──────────────────
  function renderConditions(player, numPlayers) {
    document.getElementById('condTitle').textContent =
      'Your Conditions - ' + getPlayerDisplayName(player.id);
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
      text.innerHTML = injectTermSymbols(c.text);
      row.appendChild(text);

      // Share buttons — one per other player (first 3 letters of name)
      const btns = document.createElement('span');
      btns.className = 'share-btns';
      for (let p = 1; p <= numPlayers; p++) {
        if (p === player.id) continue;
        const btn = document.createElement('button');
        btn.className = 'share-btn';
        btn.dataset.condIdx = i;
        btn.dataset.toPlayer = p;
        btn.textContent = getShareButtonLabel(p);
        btn.title = 'Share with ' + getPlayerDisplayName(p);
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

      if (data.playerNames && typeof data.playerNames === 'object') {
        serverPlayerNames = { ...data.playerNames };
        if (scenarioData) {
          const player = scenarioData.players[selectedPlayer - 1];
          renderConditions(player, scenarioData.numPlayers);
        }
        renderSharedConditions(data.sharedWithYou);
        const nameInput = document.getElementById('yourNameInput');
        if (nameInput && document.activeElement !== nameInput)
          nameInput.value = serverPlayerNames[String(selectedPlayer)] || '';
      }

      // Update outgoing share button states
      document.querySelectorAll('.share-btn').forEach(btn => {
        const ci = parseInt(btn.dataset.condIdx);
        const tp = parseInt(btn.dataset.toPlayer);
        const sharedTo = data.sharedByYou && data.sharedByYou[ci];
        const isShared = sharedTo && sharedTo.includes(tp);
        if (!sharedTo || sharedTo.length === 0) {
          btn.classList.remove('active');
        } else {
          btn.classList.toggle('active', isShared);
        }
      });

      if (!data.playerNames) renderSharedConditions(data.sharedWithYou);
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
      header.textContent = 'From ' + getPlayerDisplayName(parseInt(from, 10)) + ':';
      container.appendChild(header);
      for (const text of texts) {
        const item = document.createElement('div');
        item.className = 'shared-item';
        item.innerHTML = injectTermSymbols(text);
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
