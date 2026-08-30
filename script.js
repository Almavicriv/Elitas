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
  var STORAGE_KEY = "elitas_game_state_v3";
  var CARD_SIZE = 5;
  var UI_LOCK_MS = 220;
  var SVG_NS = "http://www.w3.org/2000/svg";
  var SPIRAL_CX = 160;
  var SPIRAL_CY = 160;
  var SPIRAL_R_MAX = 145;
  var SPIRAL_R_MIN = 22;
  var SPIRAL_STEPS_PER_TURN = 9;
  var SPECIAL_SQUARE_GAP_MIN = 4;
  var SPECIAL_SQUARE_GAP_SPAN = 2; // gap is MIN..MIN+SPAN-1 (4 or 5)

  // ===================== State =====================
  var shuffledDefaultNames = shuffle(DEFAULT_TEAM_NAMES);

  var state = {
    screen: "settings",
    settings: {
      numTeams: 2,
      teamNames: shuffledDefaultNames.slice(0, 2),
      timerDuration: 60,
      winSteps: DEFAULT_STEPS[2],
      stepsManuallyEdited: false,
    },
    game: null,
  };

  var timerIntervalId = null;
  var countdownTimeoutIds = [];
  var uiLocked = false;
  var pendingStartAfterHelp = false;
  var pendingBonusOriginTeam = null;
  var audioCtx = null;

  // ===================== Voice-over sound files =====================
  // עדכנו את הנתיבים כך שיתאימו למיקום קבצי ה-mp3 בפרויקט שלכם.
  var VOICE_SOUND_PATHS = {
    whoIsUp: "assets/sounds/מי עולה.mp3.mpeg",
    briefingStart: "assets/sounds/תדריך מצטרפים.mp3.mpeg",
    takeoffCountdown: "assets/sounds/רשאים להמריא בעוד 321.mp3.mpeg",
  };

  // תזמון (במילישניות מתחילת ההקלטה) של הרגעים בהם נשמעים "3", "2", "1"
  // בהקלטת "רשאים להמריא בעוד... 3 2 1", כדי לסנכרן את התצוגה עם הקול.
  var TAKEOFF_NUMBER_TIMINGS_MS = [2375, 3420, 3985];
  var TAKEOFF_TOTAL_DURATION_MS = 4300;

  var voiceSounds = {
    whoIsUp: new Audio(VOICE_SOUND_PATHS.whoIsUp),
    briefingStart: new Audio(VOICE_SOUND_PATHS.briefingStart),
    takeoffCountdown: new Audio(VOICE_SOUND_PATHS.takeoffCountdown),
  };

  function playVoiceSound(key) {
    var audio = voiceSounds[key];
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      var p = audio.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    } catch (e) {
      /* ignore playback failures (e.g. autoplay restrictions) */
    }
  }

  function stopVoiceSound(key) {
    var audio = voiceSounds[key];
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (e) {
      /* ignore */
    }
  }

  function clearCountdownTimeouts() {
    countdownTimeoutIds.forEach(function (id) {
      clearTimeout(id);
    });
    countdownTimeoutIds = [];
  }

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

  function randomizeDefaultNames() {
    shuffledDefaultNames = shuffle(DEFAULT_TEAM_NAMES);
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

  function playBuzzer() {
    playTone(220, 550, "sawtooth");
  }

  function playCountdownBeep() {
    playTone(523, 150, "sine");
  }

  function playCountdownGo() {
    playTone(659, 260, "sine");
  }

  function playSuccessSound() {
    playTone(880, 90, "sine");
    setTimeout(function () {
      playTone(1318, 150, "sine");
    }, 90);
  }

  function playSkipSound() {
    playTone(300, 110, "sine");
    setTimeout(function () {
      playTone(190, 160, "sine");
    }, 90);
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
      input.value = s.teamNames[i] || shuffledDefaultNames[i] || "קבוצה " + (i + 1);
      input.placeholder = "שם קבוצה " + (i + 1);
      (function (idx, inputEl) {
        inputEl.addEventListener("input", function () {
          s.teamNames[idx] = inputEl.value;
          saveState();
        });
      })(i, input);
      wrap.appendChild(input);
    }
  }

  function setNumTeams(n) {
    var s = state.settings;
    s.numTeams = n;
    var names = [];
    for (var i = 0; i < n; i++) {
      names.push(s.teamNames[i] || shuffledDefaultNames[i]);
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

  // ===================== Special squares =====================
  function generateSpecialSquares(winSteps) {
    var squares = [];
    var pos = SPECIAL_SQUARE_GAP_MIN + Math.floor(Math.random() * SPECIAL_SQUARE_GAP_SPAN);
    while (pos < winSteps) {
      squares.push(pos);
      pos += SPECIAL_SQUARE_GAP_MIN + Math.floor(Math.random() * SPECIAL_SQUARE_GAP_SPAN);
    }
    return squares;
  }

  // ===================== Game init =====================
  function startNewGame() {
    var s = state.settings;
    var teams = [];
    for (var i = 0; i < s.numTeams; i++) {
      teams.push({
        name: (s.teamNames[i] || shuffledDefaultNames[i] || "קבוצה " + (i + 1)).trim() || "קבוצה " + (i + 1),
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
      currentWordIndex: 0,
      specialSquares: generateSpecialSquares(s.winSteps),
      round: null,
      bonusRound: null,
    };

    saveState();
    pendingStartAfterHelp = true;
    playVoiceSound("briefingStart");
    openModal("modal-help");
  }

  // ===================== Deck / word flow =====================
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
    g.currentWordIndex = 0;
  }

  function ensureCurrentCard() {
    var g = state.game;
    if (!g.currentCard || g.currentWordIndex >= g.currentCard.length) {
      loadNextCard();
    }
  }

  function advanceWord() {
    var g = state.game;
    var word = g.currentCard[g.currentWordIndex];
    g.usedWords.push(word);
    g.currentWordIndex++;
    if (g.currentWordIndex >= g.currentCard.length) {
      loadNextCard();
    }
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

    var fullD =
      "M " +
      points
        .map(function (p) {
          return p.x.toFixed(1) + "," + p.y.toFixed(1);
        })
        .join(" L ");

    svg.appendChild(svgEl("path", { d: fullD, class: "spiral-path-bg" }));
    svg.appendChild(svgEl("path", { d: fullD, class: "spiral-path" }));

    // Per-team progress trail: a colored line from the start to each team's current spot.
    g.teams.forEach(function (team) {
      var pos = clamp(team.position, 0, g.winSteps);
      if (pos === 0) return;
      var trailPoints = points.slice(0, pos + 1);
      var trailD =
        "M " +
        trailPoints
          .map(function (p) {
            return p.x.toFixed(1) + "," + p.y.toFixed(1);
          })
          .join(" L ");
      svg.appendChild(
        svgEl("path", { d: trailD, class: "spiral-progress-trail", stroke: team.color, opacity: "0.55" })
      );
    });

    // Special "bonus" squares.
    g.specialSquares.forEach(function (idx) {
      var p = points[idx];
      var icon = svgEl("text", {
        x: p.x.toFixed(1),
        y: (p.y + 5).toFixed(1),
        class: "spiral-special-icon",
        "text-anchor": "middle",
      });
      icon.textContent = "⚠️";
      svg.appendChild(icon);
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

    // Pawns mark only each team's current (last) space.
    g.teams.forEach(function (team, idx) {
      var p = points[clamp(team.position, 0, g.winSteps)];
      var circle = svgEl("circle", {
        cx: p.x.toFixed(1),
        cy: p.y.toFixed(1),
        r: 10,
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

  // ===================== End game mid-way =====================
  function endGameNow() {
    clearInterval(timerIntervalId);
    clearCountdownTimeouts();
    stopVoiceSound("takeoffCountdown");
    timerIntervalId = null;
    state.game = null;
    renderSettings();
    showScreen("settings");
  }

  // ===================== Round flow =====================
  function beginRound(teamIndex) {
    var g = state.game;
    var startPos = g.teams[teamIndex].position;
    if (g.specialSquares.indexOf(startPos) !== -1) {
      pendingBonusOriginTeam = teamIndex;
      g.round = null;
    } else {
      pendingBonusOriginTeam = null;
      g.round = {
        teamIndex: teamIndex,
        correct: 0,
        skipped: 0,
        startPosition: startPos,
      };
    }
    saveState();
    startCountdown(teamIndex, pendingBonusOriginTeam !== null);
  }

  function startCountdown(teamIndex, isBonus) {
    var g = state.game;
    var team = g.teams[teamIndex];
    $("countdown-team-name").textContent = isBonus ? "⚠️ נחיתה על מלכודת — סיבוב פתוח לכולם!" : team.name;
    $("countdown-number").textContent = "";
    showScreen("countdown");

    clearCountdownTimeouts();
    playVoiceSound("takeoffCountdown");

    // מציגים את המספרים 3, 2, 1 בדיוק ברגעים שבהם הם נשמעים בהקלטה.
    TAKEOFF_NUMBER_TIMINGS_MS.forEach(function (delay, i) {
      var number = TAKEOFF_NUMBER_TIMINGS_MS.length - i;
      countdownTimeoutIds.push(
        setTimeout(function () {
          $("countdown-number").textContent = String(number);
        }, delay)
      );
    });

    // בסיום ההקלטה עוברים למשחק (או לסיבוב הבונוס).
    countdownTimeoutIds.push(
      setTimeout(function () {
        countdownTimeoutIds = [];
        if (isBonus) {
          startBonusRound();
        } else {
          startCardGame();
        }
      }, TAKEOFF_TOTAL_DURATION_MS)
    );
  }

  function startCardGame() {
    ensureCurrentCard();
    renderCardGame();
    $("steal-btn").classList.add("hidden");
    setCardButtonsEnabled(true);
    showScreen("cardgame");
    startTimer();
  }

  function renderCardGame() {
    var g = state.game;
    var bonus = !!g.bonusRound;

    $("active-word").textContent = g.currentCard[g.currentWordIndex];

    $("cardgame-top-normal").classList.toggle("hidden", bonus);
    $("bonus-banner").classList.toggle("hidden", !bonus);
    $("normal-actions").classList.toggle("hidden", bonus);
    $("bonus-actions").classList.toggle("hidden", !bonus);
    if (bonus) $("steal-btn").classList.add("hidden");

    if (bonus) {
      renderBonusButtons();
    } else {
      $("stat-correct").textContent = "✔ " + g.round.correct;
      $("stat-skipped").textContent = "⤼ " + g.round.skipped;
      var net = g.round.correct - g.round.skipped;
      $("stat-net").textContent = (net > 0 ? "+" : "") + net;
    }
  }

  function renderBonusButtons() {
    var g = state.game;
    var wrap = $("bonus-team-buttons");
    wrap.innerHTML = "";
    g.teams.forEach(function (team, idx) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bonus-team-btn";
      btn.style.background = team.color;
      btn.textContent = team.name;
      btn.addEventListener("click", function () {
        onBonusPick(idx);
      });
      wrap.appendChild(btn);
    });
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

  function onCorrect() {
    withUiLock(function () {
      var g = state.game;
      if (!g.round) return;
      playSuccessSound();
      var timeWasUp = g.round.timeLeft <= 0;
      g.round.correct++;
      advanceWord();
      if (timeWasUp) {
        goToSummary();
      } else {
        renderCardGame();
        saveState();
      }
    });
  }

  function onSkip() {
    withUiLock(function () {
      var g = state.game;
      if (!g.round) return;
      playSkipSound();
      var timeWasUp = g.round.timeLeft <= 0;
      g.round.skipped++;
      advanceWord();
      if (timeWasUp) {
        goToSummary();
      } else {
        renderCardGame();
        saveState();
      }
    });
  }

  function onTimeUp() {
    playBuzzer();
    vibrate([120, 60, 200]);
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
    var word = g.currentCard[g.currentWordIndex];
    g.usedWords.push(word);

    var team = g.teams[teamIndex];
    team.position = clamp(team.position + 1, 0, g.winSteps);
    saveState();

    if (team.position >= g.winSteps) {
      finishActiveWordAfterSteal();
      showVictory(teamIndex);
      return;
    }
    finishActiveWordAfterSteal();
    goToSummary();
  }

  function finishActiveWordAfterSteal() {
    var g = state.game;
    g.currentWordIndex++;
    if (g.currentWordIndex >= g.currentCard.length) {
      loadNextCard();
    }
  }

  function noOneStole() {
    var g = state.game;
    var word = g.currentCard[g.currentWordIndex];
    g.usedWords.push(word);
    g.currentWordIndex++;
    if (g.currentWordIndex >= g.currentCard.length) {
      loadNextCard();
    }
    saveState();
    goToSummary();
  }

  // ===================== Bonus round flow (special squares) =====================
  function startBonusRound() {
    var g = state.game;
    ensureCurrentCard();
    g.bonusRound = {
      originTeamIndex: pendingBonusOriginTeam,
      gains: g.teams.map(function () {
        return 0;
      }),
      wordsResolved: 0,
      totalWords: g.currentCard.length,
    };
    pendingBonusOriginTeam = null;
    renderCardGame();
    showScreen("cardgame");
    saveState();
  }

  function onBonusPick(teamIndex) {
    withUiLock(function () {
      resolveBonusWord(teamIndex);
    });
  }

  function onBonusSkip() {
    withUiLock(function () {
      resolveBonusWord(null);
    });
  }

  function resolveBonusWord(teamIndex) {
    var g = state.game;
    var br = g.bonusRound;
    if (!br) return;
    if (teamIndex !== null) {
      playSuccessSound();
    } else {
      playSkipSound();
    }
    var word = g.currentCard[g.currentWordIndex];
    g.usedWords.push(word);

    if (teamIndex !== null) {
      var team = g.teams[teamIndex];
      team.position = clamp(team.position + 1, 0, g.winSteps);
      br.gains[teamIndex]++;
      if (team.position >= g.winSteps) {
        g.bonusRound = null;
        saveState();
        showVictory(teamIndex);
        return;
      }
    }

    br.wordsResolved++;
    g.currentWordIndex++;
    if (g.currentWordIndex >= g.currentCard.length) {
      loadNextCard();
    }
    saveState();

    if (br.wordsResolved >= br.totalWords) {
      goToBonusSummary();
    } else {
      renderCardGame();
    }
  }

  function goToBonusSummary() {
    var g = state.game;
    var br = g.bonusRound;
    var list = $("bonus-summary-list");
    list.innerHTML = "";
    var anyGain = false;
    g.teams.forEach(function (team, idx) {
      var gain = br.gains[idx];
      if (gain <= 0) return;
      anyGain = true;
      var row = document.createElement("div");
      row.className = "bonus-summary-row";
      var nameSpan = document.createElement("span");
      nameSpan.textContent = team.name;
      var gainSpan = document.createElement("span");
      gainSpan.className = "bonus-summary-gain";
      gainSpan.textContent = "+" + gain;
      row.appendChild(nameSpan);
      row.appendChild(gainSpan);
      list.appendChild(row);
    });
    if (!anyGain) {
      var empty = document.createElement("div");
      empty.className = "bonus-summary-row";
      empty.textContent = "אף אחת מהקבוצות לא ניחשה במחזור המיוחד הזה.";
      list.appendChild(empty);
    }
    showScreen("bonus-summary");
    saveState();
  }

  function onBonusSummaryContinue() {
    state.game.bonusRound = null;
    saveState();
    goToBoard();
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
    randomizeDefaultNames();
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
      case "bonus-summary":
        if (state.game.bonusRound) {
          renderBoard();
          goToBonusSummary();
        } else {
          goToBoard();
        }
        break;
      case "cardgame":
        if (state.game.bonusRound && state.game.currentCard) {
          resumeBonusRound();
        } else if (state.game.round && state.game.currentCard && state.game.round.timeLeft > 0) {
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

  function resumeBonusRound() {
    renderCardGame();
    showScreen("cardgame");
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
    $("team-pick-close-btn").addEventListener("click", function () {
      closeModal("modal-team-pick");
    });

    $("end-game-btn").addEventListener("click", function () {
      openModal("modal-end-game");
    });
    $("end-game-cancel-btn").addEventListener("click", function () {
      closeModal("modal-end-game");
    });
    $("end-game-confirm-btn").addEventListener("click", function () {
      closeModal("modal-end-game");
      endGameNow();
    });

    $("correct-btn").addEventListener("click", onCorrect);
    $("skip-btn").addEventListener("click", onSkip);
    $("steal-btn").addEventListener("click", openStealModal);
    $("steal-cancel-btn").addEventListener("click", function () {
      closeModal("modal-steal-pick");
      noOneStole();
    });
    $("steal-modal-close-btn").addEventListener("click", function () {
      closeModal("modal-steal-pick");
    });
    $("bonus-skip-btn").addEventListener("click", onBonusSkip);

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

    $("bonus-summary-continue-btn").addEventListener("click", onBonusSummaryContinue);

    $("new-game-btn").addEventListener("click", startNewGameFromVictory);

    $("help-btn").addEventListener("click", function () {
      pendingStartAfterHelp = false;
      openModal("modal-help");
    });
    $("help-close-btn").addEventListener("click", closeHelp);

    $("splash-continue-btn").addEventListener("click", leaveSplash);
  }

  // ===================== Splash screen =====================
  function showSplash() {
    var screens = document.querySelectorAll(".screen");
    for (var i = 0; i < screens.length; i++) {
      screens[i].classList.toggle("active", screens[i].id === "screen-splash");
    }
    document.body.classList.add("on-splash");
    $("splash-continue-btn").textContent = state.game ? "המשך משחק" : "התחל";
  }

  function leaveSplash() {
    if (!state.game) {
      playVoiceSound("whoIsUp");
    }
    document.body.classList.remove("on-splash");
    restoreScreenOnLoad();
  }

  // ===================== Init =====================
  function init() {
    loadState();
    wireEvents();
    randomizeDefaultNames();
    if (!state.settings.teamNames || state.settings.teamNames.length !== state.settings.numTeams) {
      state.settings.teamNames = shuffledDefaultNames.slice(0, state.settings.numTeams);
    }
    showSplash();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
