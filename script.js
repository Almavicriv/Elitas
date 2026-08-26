(function () {
  "use strict";

  // ===================== Constants =====================
  var TEAM_COLORS = ["#e6503a", "#2fb45a", "#7a5cff", "#f2b632"];
  var DEFAULT_TEAM_NAMES = [
    "טייסת האליאס",
    "הכטבמים המתפוצצים",
    "טסים לניצחון",
    "מפקחים על האויב",
    "הבקרים האלופים",
    "סיירת המילים",
  ];
  var DEFAULT_STEPS = { 2: 40, 3: 35, 4: 30 };
  var STORAGE_KEY = "elitas_game_state_v2";
  var CARD_SIZE = 5;
  var UI_LOCK_MS = 220;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SPIRAL_CX = 160;
  var SPIRAL_CY = 160;
  var SPIRAL_R_MAX = 145;
  var SPIRAL_R_MIN = 22;
  var SPIRAL_STEPS_PER_TURN = 9;

  // ===================== State =====================
  var state = {
    screen: "settings",
    settings: {
      numTeams: 2,
      teamNames: DEFAULT_TEAM_NAMES.slice(0, 2),
      timerDuration: 60,
      winSteps: DEFAULT_STEPS[2],
      stepsManuallyEdited: false,
    },
    game: null,
  };

  var timerIntervalId = null;
  var countdownIntervalId = null;
  var uiLocked = false;
  var pendingStartAfterHelp = false;
  var audioCtx = null;

  // ===================== Utilities =====================
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  function buildDeck(pool) {
    var deck = [];
    for (var i = 0; i < pool.length; i += CARD_SIZE) {
      deck.push(pool.slice(i, i + CARD_SIZE));
    }
    return deck;
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function $(id) {
    return document.getElementById(id);
  }

  function svgEl(tag, attrs) {
    var el = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
    }
    return el;
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      /* ignore storage failures */
    }
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var parsed = JSON.parse(raw);
      if (!parsed || !parsed.settings) return false;
      state = parsed;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ===================== Audio & Haptics =====================
  function getAudioCtx() {
    if (!audioCtx) {
      try {
        var Ctx = window.AudioContext || window.webkitAudioContext;
        audioCtx = new Ctx();
      } catch (e) {
        audioCtx = null;
      }
    }
    return audioCtx;
  }

  function playTone(freq, durationMs, type) {
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + durationMs / 1000);
    } catch (e) {
      /* ignore */
    }
  }

  function playTick() {
    playTone(880, 120, "square");
  }

  function playBuzzer() {
    playTone(220, 550, "sawtooth");
  }

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* ignore */
    }
  }

  // ===================== Screen management =====================
  function showScreen(name) {
    state.screen = name;
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("active", screens[i].id === "screen-" + name);
    }
    document.body.classList.toggle("hide-header-ingame", name === "cardgame");
    saveState();
  }

  function openModal(id) {
    $(id).classList.remove("hidden");
  }

  function closeModal(id) {
    $(id).classList.add("hidden");
  }

  // ===================== Settings screen =====================
  function renderSettings() {
    var s = state.settings;

    var countBtns = document.querySelectorAll("#team-count-selector .segmented-btn");
    countBtns.forEach(function (btn) {
      btn.classList.toggle("selected", Number(btn.dataset.value) === s.numTeams);
    });

    var timerBtns = document.querySelectorAll("#timer-selector .segmented-btn");
    timerBtns.forEach(function (btn) {
      btn.classList.toggle("selected", Number(btn.dataset.value) === s.timerDuration);
    });

    $("win-steps-input").value = s.winSteps;

    renderTeamNamesList();
  }

  function renderTeamNamesList() {
    var s = state.settings;
    var wrap = $("team-names-list");
    wrap.innerHTML = "";
    for (var i = 0; i < s.numTeams; i++) {
      var input = document.createElement("input");
      input.type = "text";
      input.className = "team-name-input";
      input.maxLength = 40;
      input.value = s.teamNames[i] || DEFAULT_TEAM_NAMES[i] || "קבוצה " + (i + 1);
      input.placeholder = "שם קבוצה " + (i + 1);
      (function (idx) {
        input.addEventListener("input", function () {
          s.teamNames[idx] = input.value;
          saveState();
        });
      })(i);
      wrap.appendChild(input);
    }
  }

  function setNumTeams(n) {
    var s = state.settings;
    s.numTeams = n;
    var names = [];
    for (var i = 0; i < n; i++) {
      names.push(s.teamNames[i] || DEFAULT_TEAM_NAMES[i]);
    }
    s.teamNames = names;
    if (!s.stepsManuallyEdited) {
      s.winSteps = DEFAULT_STEPS[n];
    }
    renderSettings();
    saveState();
  }

  function setTimerDuration(sec) {
    state.settings.timerDuration = sec;
    renderSettings();
    saveState();
  }

  function setWinSteps(val) {
    val = clamp(Math.round(val) || 20, 20, 50);
    state.settings.winSteps = val;
    state.settings.stepsManuallyEdited = true;
    $("win-steps-input").value = val;
    saveState();
  }

  // ===================== Game init =====================
  function startNewGame() {
    var s = state.settings;
    var teams = [];
    for (var i = 0; i < s.numTeams; i++) {
      teams.push({
        name: (s.teamNames[i] || DEFAULT_TEAM_NAMES[i] || "קבוצה " + (i + 1)).trim() || "קבוצה " + (i + 1),
        color: TEAM_COLORS[i],
        position: 0,
      });
    }

    state.game = {
      teams: teams,
      winSteps: s.winSteps,
      timerDuration: s.timerDuration,
      deck: buildDeck(shuffle(WORDS)),
      usedWords: [],
      currentCard: null,
      usedSlots: null,
      round: null,
    };

    saveState();
    pendingStartAfterHelp = true;
    openModal("modal-help");
  }

  // ===================== Deck / numbered-card flow (real-Alias style) =====================
  // Every card has up to 5 numbered words (1-5). During a round, only the word whose
  // number matches the team's current live board position (mod 5) may be read aloud.
  function loadNextCard() {
    var g = state.game;
    if (g.deck.length === 0) {
      if (g.usedWords.length > 0) {
        g.deck = buildDeck(shuffle(g.usedWords));
        g.usedWords = [];
      } else {
        g.deck = buildDeck(shuffle(WORDS));
      }
    }
    g.currentCard = g.deck.shift();
    g.usedSlots = g.currentCard.map(function () {
      return false;
    });
  }

  function abandonCurrentCard() {
    var g = state.game;
    if (g.currentCard) {
      for (var i = 0; i < g.currentCard.length; i++) {
        if (!g.usedSlots[i]) g.usedWords.push(g.currentCard[i]);
      }
    }
    g.currentCard = null;
    g.usedSlots = null;
  }

  function ensureCardForSlot(slot) {
    var g = state.game;
    var attempts = 0;
    while ((!g.currentCard || slot >= g.currentCard.length || g.usedSlots[slot]) && attempts < 500) {
      abandonCurrentCard();
      loadNextCard();
      attempts++;
    }
  }

  function currentLivePosition() {
    var g = state.game;
    var r = g.round;
    return clamp(r.startPosition + (r.correct - r.skipped), 0, g.winSteps);
  }

  function currentActiveSlot() {
    return currentLivePosition() % CARD_SIZE;
  }

  // ===================== Spiral board geometry =====================
  function computeSpiralPoints(numSteps) {
    var angleStep = (2 * Math.PI) / SPIRAL_STEPS_PER_TURN;
    var points = [];
    for (var i = 0; i <= numSteps; i++) {
      var t = i / numSteps;
      var r = SPIRAL_R_MAX - (SPIRAL_R_MAX - SPIRAL_R_MIN) * t;
      var theta = i * angleStep - Math.PI / 2;
      points.push({
        x: SPIRAL_CX + r * Math.cos(theta),
        y: SPIRAL_CY + r * Math.sin(theta),
      });
    }
    return points;
  }

  // ===================== Board screen =====================
  function renderBoard() {
    var g = state.game;
    var svg = $("board-track");
    svg.innerHTML = "";
    var points = computeSpiralPoints(g.winSteps);

    var d =
      "M " +
      points
        .map(function (p) {
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        })
        .join(" L ");

    svg.appendChild(svgEl("path", { d: d, class: "spiral-path-bg" }));
    svg.appendChild(svgEl("path", { d: d, class: "spiral-path" }));

    points.forEach(function (p, i) {
      var major = i % 5 === 0 || i === points.length - 1;
      svg.appendChild(
        svgEl("circle", {
          cx: p.x.toFixed(1),
          cy: p.y.toFixed(1),
          r: major ? 5 : 2.6,
          class: "spiral-dot" + (major ? " spiral-dot-major" : ""),
        })
      );
      if (major) {
        var label = svgEl("text", {
          x: p.x.toFixed(1),
          y: (p.y - 8).toFixed(1),
          class: "spiral-step-label",
          "text-anchor": "middle",
        });
        label.textContent = String(i);
        svg.appendChild(label);
      }
    });

    var startIcon = svgEl("text", {
      x: points[0].x.toFixed(1),
      y: (points[0].y - 12).toFixed(1),
      class: "spiral-start-icon",
      "text-anchor": "middle",
    });
    startIcon.textContent = "✈";
    svg.appendChild(startIcon);

    var last = points[points.length - 1];
    var finishIcon = svgEl("text", {
      x: last.x.toFixed(1),
      y: (last.y + 5).toFixed(1),
      class: "spiral-finish-icon",
      "text-anchor": "middle",
    });
    finishIcon.textContent = "🏁";
    svg.appendChild(finishIcon);

    g.teams.forEach(function (team, idx) {
      var p = points[clamp(team.position, 0, g.winSteps)];
      var circle = svgEl("circle", {
        cx: p.x.toFixed(1),
        cy: p.y.toFixed(1),
        r: 9,
        class: "track-pawn",
        fill: team.color,
      });
      var label = svgEl("text", {
        x: p.x.toFixed(1),
        y: (p.y + 3.2).toFixed(1),
        class: "track-pawn-label",
        "text-anchor": "middle",
      });
      label.textContent = String(idx + 1);
      var title = svgEl("title", {});
      title.textContent = team.name;
      circle.appendChild(title);
      svg.appendChild(circle);
      svg.appendChild(label);
    });

    var list = $("board-teams-list");
    list.innerHTML = "";
    g.teams.forEach(function (team, idx) {
      var row = document.createElement("div");
      row.className = "board-team-row";

      var dot = document.createElement("div");
      dot.className = "board-team-dot";
      dot.style.background = team.color;
      row.appendChild(dot);

      var nameSpan = document.createElement("div");
      nameSpan.className = "board-team-name-editable";
      nameSpan.textContent = team.name;
      nameSpan.addEventListener("click", function () {
        startEditTeamName(row, idx, nameSpan);
      });
      row.appendChild(nameSpan);

      var posSpan = document.createElement("div");
      posSpan.className = "board-team-pos";
      posSpan.textContent = team.position + " / " + g.winSteps;
      row.appendChild(posSpan);

      list.appendChild(row);
    });
  }

  function startEditTeamName(row, idx, nameSpan) {
    var input = document.createElement("input");
    input.type = "text";
    input.className = "board-team-name-input";
    input.maxLength = 40;
    input.value = state.game.teams[idx].name;
    row.replaceChild(input, nameSpan);
    input.focus();
    input.select();

    function commit() {
      var val = input.value.trim();
      if (val) state.game.teams[idx].name = val;
      saveState();
      renderBoard();
    }

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") input.blur();
    });
  }

  function openTeamPickModal() {
    var g = state.game;
    var list = $("team-pick-list");
    list.innerHTML = "";
    g.teams.forEach(function (team, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-pick-btn";
      btn.textContent = team.name;
      btn.addEventListener("click", function () {
        closeModal("modal-team-pick");
        beginRound(idx);
      });
      list.appendChild(btn);
    });
    openModal("modal-team-pick");
  }

  function randomTeamPick() {
    var g = state.game;
    var idx = Math.floor(Math.random() * g.teams.length);
    var buttons = document.querySelectorAll("#team-pick-list .team-pick-btn");
    buttons.forEach(function (btn, i) {
      btn.classList.toggle("picked", i === idx);
    });
    setTimeout(function () {
      closeModal("modal-team-pick");
      beginRound(idx);
    }, 650);
  }

  // ===================== Round flow =====================
  function beginRound(teamIndex) {
    var g = state.game;
    abandonCurrentCard();
    g.round = {
      teamIndex: teamIndex,
      correct: 0,
      skipped: 0,
      startPosition: g.teams[teamIndex].position,
    };
    saveState();
    startCountdown();
  }

  function startCountdown() {
    var g = state.game;
    var team = g.teams[g.round.teamIndex];
    $("countdown-team-name").textContent = team.name;
    var n = 3;
    $("countdown-number").textContent = String(n);
    showScreen("countdown");
    clearInterval(countdownIntervalId);
    countdownIntervalId = setInterval(function () {
      n--;
      if (n <= 0) {
        clearInterval(countdownIntervalId);
        countdownIntervalId = null;
        startCardGame();
      } else {
        $("countdown-number").textContent = String(n);
      }
    }, 1000);
  }

  function startCardGame() {
    ensureCardForSlot(currentActiveSlot());
    renderCardGame();
    $("steal-btn").classList.add("hidden");
    setCardButtonsEnabled(true);
    showScreen("cardgame");
    startTimer();
  }

  function renderCardGame() {
    var g = state.game;
    var activeSlot = currentActiveSlot();
    $("active-number-badge").textContent = String(activeSlot + 1);

    var wordList = $("word-list");
    wordList.innerHTML = "";
    g.currentCard.forEach(function (word, idx) {
      var row = document.createElement("div");
      row.className = "word-row";
      if (idx === activeSlot) row.classList.add("active");
      else if (g.usedSlots[idx]) row.classList.add("done");

      var numberEl = document.createElement("div");
      numberEl.className = "word-number";
      numberEl.textContent = String(idx + 1);
      row.appendChild(numberEl);

      var textEl = document.createElement("div");
      textEl.className = "word-text";
      textEl.textContent = word;
      row.appendChild(textEl);

      wordList.appendChild(row);
    });

    $("stat-correct").textContent = "✔ " + g.round.correct;
    $("stat-skipped").textContent = "⤼ " + g.round.skipped;
    var net = g.round.correct - g.round.skipped;
    $("stat-net").textContent = (net > 0 ? "+" : "") + net;
  }

  function setCardButtonsEnabled(enabled) {
    $("correct-btn").disabled = !enabled;
    $("skip-btn").disabled = !enabled;
  }

  function startTimer() {
    var g = state.game;
    g.round.timeLeft = g.timerDuration;
    renderTimer();
    clearInterval(timerIntervalId);
    timerIntervalId = setInterval(timerTick, 1000);
    saveState();
  }

  function renderTimer() {
    var t = state.game.round.timeLeft;
    var el = $("cardgame-timer");
    el.textContent = String(t);
    el.classList.toggle("timer-warning", t <= 3 && t > 0);
  }

  function timerTick() {
    var g = state.game;
    g.round.timeLeft--;
    if (g.round.timeLeft <= 0) {
      clearInterval(timerIntervalId);
      timerIntervalId = null;
      renderTimer();
      onTimeUp();
    } else {
      if (g.round.timeLeft <= 3) {
        playTick();
        vibrate(60);
      }
      renderTimer();
      saveState();
    }
  }

  function withUiLock(fn) {
    if (uiLocked) return;
    uiLocked = true;
    fn();
    setTimeout(function () {
      uiLocked = false;
    }, UI_LOCK_MS);
  }

  function markSlotUsedAndAdvance(slot, delta) {
    var g = state.game;
    g.usedWords.push(g.currentCard[slot]);
    g.usedSlots[slot] = true;
    if (delta > 0) g.round.correct++;
    else g.round.skipped++;
    var nextSlot = currentActiveSlot();
    ensureCardForSlot(nextSlot);
  }

  function onCorrect() {
    withUiLock(function () {
      var g = state.game;
      if (!g.round || g.round.timeLeft <= 0) return;
      markSlotUsedAndAdvance(currentActiveSlot(), 1);
      renderCardGame();
      saveState();
    });
  }

  function onSkip() {
    withUiLock(function () {
      var g = state.game;
      if (!g.round || g.round.timeLeft <= 0) return;
      markSlotUsedAndAdvance(currentActiveSlot(), -1);
      renderCardGame();
      saveState();
    });
  }

  function onTimeUp() {
    playBuzzer();
    vibrate([120, 60, 200]);
    setCardButtonsEnabled(false);
    $("steal-btn").classList.remove("hidden");
    saveState();
  }

  function openStealModal() {
    var g = state.game;
    var list = $("steal-pick-list");
    list.innerHTML = "";
    g.teams.forEach(function (team, idx) {
      if (idx === g.round.teamIndex) return;
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-pick-btn";
      btn.textContent = team.name;
      btn.addEventListener("click", function () {
        closeModal("modal-steal-pick");
        awardSteal(idx);
      });
      list.appendChild(btn);
    });
    openModal("modal-steal-pick");
  }

  function awardSteal(teamIndex) {
    var g = state.game;
    var slot = currentActiveSlot();
    g.usedWords.push(g.currentCard[slot]);
    g.usedSlots[slot] = true;

    var team = g.teams[teamIndex];
    team.position = clamp(team.position + 1, 0, g.winSteps);
    saveState();

    if (team.position >= g.winSteps) {
      showVictory(teamIndex);
      return;
    }
    goToSummary();
  }

  function noOneStole() {
    var g = state.game;
    var slot = currentActiveSlot();
    g.usedWords.push(g.currentCard[slot]);
    g.usedSlots[slot] = true;
    saveState();
    goToSummary();
  }

  // ===================== Round summary =====================
  function goToSummary() {
    var g = state.game;
    var team = g.teams[g.round.teamIndex];
    $("summary-team-name").textContent = team.name;
    $("summary-correct-input").value = g.round.correct;
    $("summary-skipped-input").value = g.round.skipped;
    $("summary-start-pos").textContent = g.round.startPosition;

    var endPos = clamp(g.round.startPosition + (g.round.correct - g.round.skipped), 0, g.winSteps);
    team.position = endPos;
    $("summary-end-pos").textContent = endPos;

    showScreen("summary");
    saveState();
  }

  function updateSummaryFromInputs() {
    var g = state.game;
    var team = g.teams[g.round.teamIndex];
    var correct = Math.max(0, parseInt($("summary-correct-input").value, 10) || 0);
    var skipped = Math.max(0, parseInt($("summary-skipped-input").value, 10) || 0);
    g.round.correct = correct;
    g.round.skipped = skipped;

    var endPos = clamp(g.round.startPosition + (correct - skipped), 0, g.winSteps);
    team.position = endPos;
    $("summary-end-pos").textContent = endPos;
    saveState();
  }

  function onSummaryContinue() {
    var g = state.game;
    var team = g.teams[g.round.teamIndex];
    g.round = null;
    abandonCurrentCard();
    saveState();
    if (team.position >= g.winSteps) {
      showVictory(g.teams.indexOf(team));
    } else {
      goToBoard();
    }
  }

  // ===================== Board / Victory navigation =====================
  function goToBoard() {
    renderBoard();
    showScreen("board");
  }

  function showVictory(teamIndex) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
    var team = state.game.teams[teamIndex];
    $("victory-team-name").textContent = team.name;
    showScreen("victory");
  }

  function startNewGameFromVictory() {
    state.game = null;
    renderSettings();
    showScreen("settings");
  }

  // ===================== Help modal =====================
  function closeHelp() {
    closeModal("modal-help");
    if (pendingStartAfterHelp) {
      pendingStartAfterHelp = false;
      goToBoard();
    }
  }

  // ===================== Restore on load =====================
  function restoreScreenOnLoad() {
    if (!state.game) {
      renderSettings();
      showScreen("settings");
      return;
    }
    switch (state.screen) {
      case "board":
        goToBoard();
        break;
      case "summary":
        if (state.game.round) {
          renderBoard();
          goToSummaryRestore();
        } else {
          goToBoard();
        }
        break;
      case "cardgame":
        if (state.game.round && state.game.currentCard && state.game.round.timeLeft > 0) {
          resumeCardGame();
        } else {
          goToBoard();
        }
        break;
      case "victory":
        if (state.game.teams && state.game.teams.length) {
          var winner = state.game.teams.filter(function (t) {
            return t.position >= state.game.winSteps;
          })[0];
          if (winner) {
            $("victory-team-name").textContent = winner.name;
            showScreen("victory");
          } else {
            goToBoard();
          }
        } else {
          goToBoard();
        }
        break;
      default:
        goToBoard();
    }
  }

  function goToSummaryRestore() {
    var g = state.game;
    var team = g.teams[g.round.teamIndex];
    $("summary-team-name").textContent = team.name;
    $("summary-correct-input").value = g.round.correct;
    $("summary-skipped-input").value = g.round.skipped;
    $("summary-start-pos").textContent = g.round.startPosition;
    var endPos = clamp(g.round.startPosition + (g.round.correct - g.round.skipped), 0, g.winSteps);
    $("summary-end-pos").textContent = endPos;
    showScreen("summary");
  }

  function resumeCardGame() {
    renderCardGame();
    $("steal-btn").classList.add("hidden");
    setCardButtonsEnabled(true);
    renderTimer();
    showScreen("cardgame");
    clearInterval(timerIntervalId);
    timerIntervalId = setInterval(timerTick, 1000);
  }

  // ===================== Event wiring =====================
  function wireEvents() {
    document.querySelectorAll("#team-count-selector .segmented-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setNumTeams(Number(btn.dataset.value));
      });
    });

    document.querySelectorAll("#timer-selector .segmented-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTimerDuration(Number(btn.dataset.value));
      });
    });

    $("win-steps-input").addEventListener("input", function () {
      state.settings.stepsManuallyEdited = true;
      saveState();
    });
    $("win-steps-input").addEventListener("blur", function () {
      setWinSteps(parseInt($("win-steps-input").value, 10));
    });
    $("steps-minus").addEventListener("click", function () {
      setWinSteps((parseInt($("win-steps-input").value, 10) || 20) - 1);
    });
    $("steps-plus").addEventListener("click", function () {
      setWinSteps((parseInt($("win-steps-input").value, 10) || 20) + 1);
    });

    $("start-game-btn").addEventListener("click", startNewGame);

    $("start-round-btn").addEventListener("click", openTeamPickModal);
    $("random-team-btn").addEventListener("click", randomTeamPick);

    $("correct-btn").addEventListener("click", onCorrect);
    $("skip-btn").addEventListener("click", onSkip);
    $("steal-btn").addEventListener("click", openStealModal);
    $("steal-cancel-btn").addEventListener("click", function () {
      closeModal("modal-steal-pick");
      noOneStole();
    });

    $("summary-correct-input").addEventListener("input", updateSummaryFromInputs);
    $("summary-skipped-input").addEventListener("input", updateSummaryFromInputs);
    $("summary-correct-minus").addEventListener("click", function () {
      var input = $("summary-correct-input");
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
      updateSummaryFromInputs();
    });
    $("summary-correct-plus").addEventListener("click", function () {
      var input = $("summary-correct-input");
      input.value = (parseInt(input.value, 10) || 0) + 1;
      updateSummaryFromInputs();
    });
    $("summary-skipped-minus").addEventListener("click", function () {
      var input = $("summary-skipped-input");
      input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
      updateSummaryFromInputs();
    });
    $("summary-skipped-plus").addEventListener("click", function () {
      var input = $("summary-skipped-input");
      input.value = (parseInt(input.value, 10) || 0) + 1;
      updateSummaryFromInputs();
    });
    $("summary-continue-btn").addEventListener("click", onSummaryContinue);

    $("new-game-btn").addEventListener("click", startNewGameFromVictory);

    $("help-btn").addEventListener("click", function () {
      pendingStartAfterHelp = false;
      openModal("modal-help");
    });
    $("help-close-btn").addEventListener("click", closeHelp);
  }

  // ===================== Init =====================
  function init() {
    loadState();
    wireEvents();
    if (!state.settings.teamNames || state.settings.teamNames.length !== state.settings.numTeams) {
      state.settings.teamNames = DEFAULT_TEAM_NAMES.slice(0, state.settings.numTeams);
    }
    restoreScreenOnLoad();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
