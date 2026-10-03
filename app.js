// app.js — tiny state machine, no framework.
//
// Screens: "home" (deck grid) <-> "session" (standalone deck OR conversation deck)
// The Explain modal is a global overlay that works for any {thai,translit,english,tokens,related}
// object, whether that's a standalone item or a conversation turn.

const appEl = document.getElementById("app");
const backBtn = document.getElementById("back-btn");
const modalOverlay = document.getElementById("modal-overlay");
const modalCard = document.getElementById("modal-card");

const state = {
  screen: "home",
  deck: null,

  // standalone session
  order: [],
  pos: 0,
  score: 0,
  answered: false,
  buildZone: [],
  placedFlags: [],

  // conversation session
  turnIndex: 0,
  revealedTurns: [],
  compIndex: 0,
  compScore: 0,
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------------- Text-to-speech ----------------
// Prototype-only audio: Web Speech API, no recorded files.
// Thai voice availability/quality varies by browser.
function speak(text, lang) {
  if (!("speechSynthesis" in window)) {
    alert("Speech synthesis isn't supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 0.9;
  window.speechSynthesis.speak(u);
}

// ---------------- Best-score persistence (localStorage, best effort) ----------------
function bestKey(deckId) {
  return "thai-learn-best-" + deckId;
}
function getBest(deckId) {
  try {
    return localStorage.getItem(bestKey(deckId)) || "";
  } catch (e) {
    return "";
  }
}
function setBestIfBetter(deckId, score, total) {
  try {
    const prev = getBest(deckId);
    const prevScore = prev ? parseInt(prev.split("/")[0], 10) : -1;
    if (score > prevScore) {
      localStorage.setItem(bestKey(deckId), `${score}/${total}`);
    }
  } catch (e) {
    /* ignore (private mode etc.) */
  }
}

// ================================================================
// HOME SCREEN
// ================================================================
const LEVEL_LABELS = {
  1: { name: "Level 1 · Beginner", note: "Short sentences, survival phrases" },
  2: { name: "Level 2 · Intermediate", note: "Longer sentences, connectors, tenses" },
  3: { name: "Level 3 · Upper Intermediate", note: "Conditionals, concession, negotiation" },
};

function renderHome() {
  state.screen = "home";
  state.deck = null;
  backBtn.hidden = true;
  document.getElementById("score").textContent = "";
  document.getElementById("progress").textContent = "Choose a deck to practice";
  document.getElementById("progress-bar-wrap").hidden = true;

  const levels = [1, 2, 3];
  appEl.querySelector("#exercise").innerHTML = levels
    .map((lvl) => {
      const decks = DECKS.filter((d) => d.level === lvl);
      if (!decks.length) return "";
      const label = LEVEL_LABELS[lvl];
      return `
        <div class="level-section">
          <div class="level-heading">
            <span class="level-name">${label.name}</span>
            <span class="level-note">${label.note}</span>
          </div>
          <div class="deck-grid">
            ${decks.map((deck) => deckCardHtml(deck)).join("")}
          </div>
        </div>`;
    })
    .join("");

  DECKS.forEach((deck) => {
    document.getElementById(`deck-${deck.id}`).onclick = () => openDeck(deck.id);
  });
}

function deckCardHtml(deck) {
  const best = getBest(deck.id);
  const count =
    deck.kind === "conversation"
      ? `${deck.turns.length} lines + ${deck.comprehension.length} questions`
      : `${deck.items.length} exercises`;
  const kindTag = deck.kind === "conversation" ? "Conversation" : "Topic deck";
  return `
    <div class="deck-card" id="deck-${deck.id}">
      <div class="deck-cover" style="background:${deck.cover.bg}">${deck.cover.emoji}</div>
      <div class="deck-body">
        <div class="deck-kind">${kindTag}</div>
        <div class="deck-title">${deck.title}</div>
        <div class="deck-subtitle">${deck.subtitle}</div>
        <div class="deck-meta">${count}${best ? ` · Best: ${best}` : ""}</div>
      </div>
    </div>`;
}

function openDeck(deckId) {
  const deck = DECKS.find((d) => d.id === deckId);
  state.screen = "session";
  state.deck = deck;
  backBtn.hidden = false;

  if (deck.kind === "conversation") {
    startConversation(deck);
  } else {
    state.order = shuffle(deck.items.map((_, i) => i));
    state.pos = 0;
    state.score = 0;
    renderStandaloneItem();
  }
}

backBtn.onclick = renderHome;

// ================================================================
// EXPLAIN MODAL (shared by standalone items and conversation turns)
// ================================================================
function breakdownHtml(item) {
  return `
    <div class="breakdown">
      <div class="breakdown-title">Word by word</div>
      ${item.tokens
        .map(
          (t, i) => `
        <div class="breakdown-row">
          <button class="bd-speak" data-speak-word="${i}" title="Hear this word">🔊</button>
          <div class="bd-word">
            <div class="bd-thai">${t.thai}</div>
            <div class="bd-translit">${t.translit}</div>
          </div>
          <div class="bd-en">${t.en}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

function relatedHtml(item) {
  if (!item.related || !item.related.length) return "";
  return `
    <div class="related">
      <div class="breakdown-title">Related sentences</div>
      ${item.related
        .map(
          (r, i) => `
        <div class="related-row">
          <button class="bd-speak" data-related-speak="${i}" title="Hear this sentence">🔊</button>
          <div class="related-text">
            <div class="bd-thai">${r.thai}</div>
            <div class="bd-translit">${r.translit}</div>
            <div class="bd-en">${r.english}</div>
          </div>
        </div>`
        )
        .join("")}
    </div>`;
}

function openExplain(item) {
  modalCard.innerHTML = `
    <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    <div class="sentence-block" style="padding-top:6px;">
      <div class="thai-text">${item.thai}</div>
      <div class="translit-text">${item.translit}</div>
    </div>
    <div class="audio-row">
      <button class="btn-audio" id="modal-play-thai">🔊 Thai</button>
      <button class="btn-audio" id="modal-play-en">🔊 English</button>
    </div>
    <div class="prompt-text modal-en">${item.english}</div>
    ${breakdownHtml(item)}
    ${relatedHtml(item)}
  `;

  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("modal-play-thai").onclick = () => speak(item.thai, "th-TH");
  document.getElementById("modal-play-en").onclick = () => speak(item.english, "en-US");

  modalCard.querySelectorAll("[data-speak-word]").forEach((btn) => {
    btn.onclick = () => speak(item.tokens[Number(btn.dataset.speakWord)].thai, "th-TH");
  });
  modalCard.querySelectorAll("[data-related-speak]").forEach((btn) => {
    btn.onclick = () => speak(item.related[Number(btn.dataset.relatedSpeak)].thai, "th-TH");
  });

  modalOverlay.classList.remove("hidden");
}

function closeModal() {
  modalOverlay.classList.add("hidden");
  modalCard.innerHTML = "";
}

modalOverlay.onclick = (e) => {
  if (e.target === modalOverlay) closeModal();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
});

// ================================================================
// STANDALONE DECK (mcq / rearrange)
// ================================================================
function currentItem() {
  return state.deck.items[state.order[state.pos]];
}

function updateStandaloneHeader() {
  const item = currentItem();
  document.getElementById("progress").textContent =
    `${state.deck.title} · Item ${state.pos + 1} of ${state.order.length}`;
  document.getElementById("score").textContent = `Score: ${state.score}`;
  document.getElementById("progress-bar-wrap").hidden = false;
  document.getElementById("progress-fill").style.width =
    `${(state.pos / state.order.length) * 100}%`;
}

function sceneHtml(topic, image) {
  return `
    <div class="scene" style="background:${image.bg}">
      <span class="topic-tag">${topic}</span>
      ${image.emoji}
    </div>`;
}

function renderStandaloneItem() {
  if (state.pos >= state.order.length) {
    renderStandaloneDone();
    return;
  }
  const item = currentItem();
  updateStandaloneHeader();
  if (item.type === "mcq") renderMcq(item);
  else renderRearrange(item);
}

function explainButtonRow(item) {
  return `
    <div class="audio-row">
      <button class="btn-audio" id="play-thai">🔊 Thai</button>
      <button class="btn-audio" id="play-en">🔊 English</button>
      <button class="btn-audio" id="explain-btn">📖 Explain</button>
    </div>`;
}

function wireAudioAndExplain(item) {
  document.getElementById("play-thai").onclick = () => speak(item.thai, "th-TH");
  document.getElementById("play-en").onclick = () => speak(item.english, "en-US");
  document.getElementById("explain-btn").onclick = () => openExplain(item);
}

// ---------- MCQ ----------
function renderMcq(item) {
  state.answered = false;
  appEl.querySelector("#exercise").innerHTML = `
    <div class="card">
      ${sceneHtml(item.topic, item.image || state.deck.cover)}
      <div class="sentence-block">
        <div class="thai-text">${item.thai}</div>
        <div class="translit-text">${item.translit}</div>
      </div>
      ${explainButtonRow(item)}
      <div class="prompt-text">What does this mean?</div>
      <div class="options" id="options">
        ${item.options
          .map((opt, i) => `<button class="option-btn" data-idx="${i}">${opt}</button>`)
          .join("")}
      </div>
      <div class="feedback" id="feedback"></div>
      <div class="next-row" id="next-row"></div>
    </div>
  `;

  wireAudioAndExplain(item);

  document.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      if (state.answered) return;
      state.answered = true;
      const idx = Number(btn.dataset.idx);
      const correct = idx === item.correctIndex;
      if (correct) state.score++;

      document.querySelectorAll(".option-btn").forEach((b, i) => {
        b.disabled = true;
        if (i === item.correctIndex) b.classList.add("correct");
        else if (i === idx && !correct) b.classList.add("wrong");
      });

      document.getElementById("feedback").textContent = correct
        ? "Correct! 🎉"
        : "Not quite — correct answer highlighted above. Tap 📖 Explain for the breakdown.";
      document.getElementById("feedback").className = "feedback " + (correct ? "correct" : "wrong");

      document.getElementById("next-row").innerHTML = `<button class="btn-primary" id="next-btn">Next →</button>`;
      document.getElementById("next-btn").onclick = () => {
        state.pos++;
        renderStandaloneItem();
      };

      document.getElementById("score").textContent = `Score: ${state.score}`;
    };
  });
}

// ---------- Rearrange ----------
function renderRearrange(item) {
  state.answered = false;
  state.buildZone = [];
  state.placedFlags = item.tokens.map(() => false);
  const bankOrder = shuffle(item.tokens.map((_, i) => i));

  appEl.querySelector("#exercise").innerHTML = `
    <div class="card">
      ${sceneHtml(item.topic, item.image || state.deck.cover)}
      <div class="prompt-text" style="padding-top:16px;">Build the Thai sentence for:</div>
      <div class="sentence-block" style="padding-top:0;">
        <div class="translit-text" style="font-size:1.1rem;">"${item.english}"</div>
      </div>
      ${explainButtonRow(item)}
      <div class="build-zone empty" id="build-zone"></div>
      <div class="word-bank" id="word-bank">
        ${bankOrder
          .map(
            (i) => `
          <div class="chip" data-tok="${i}">
            <div class="chip-thai">${item.tokens[i].thai}</div>
            <div class="chip-translit">${item.tokens[i].translit}</div>
          </div>`
          )
          .join("")}
      </div>
      <div class="actions-row">
        <button class="btn-secondary" id="clear-btn">Clear</button>
        <button class="btn-primary" id="check-btn" disabled>Check</button>
      </div>
      <div class="feedback" id="feedback"></div>
      <div class="next-row" id="next-row"></div>
    </div>
  `;

  wireAudioAndExplain(item);

  function refreshZone() {
    const zone = document.getElementById("build-zone");
    zone.classList.toggle("empty", state.buildZone.length === 0);
    zone.innerHTML = state.buildZone
      .map(
        (i) => `
      <div class="chip in-zone" data-tok="${i}">
        <div class="chip-thai">${item.tokens[i].thai}</div>
        <div class="chip-translit">${item.tokens[i].translit}</div>
      </div>`
      )
      .join("");
    zone.querySelectorAll(".chip").forEach((chip) => {
      chip.onclick = () => {
        if (state.answered) return;
        const tok = Number(chip.dataset.tok);
        state.buildZone = state.buildZone.filter((x) => x !== tok);
        state.placedFlags[tok] = false;
        refreshZone();
        refreshBank();
      };
    });
    document.getElementById("check-btn").disabled = state.buildZone.length !== item.tokens.length;
  }

  function refreshBank() {
    document.querySelectorAll("#word-bank .chip").forEach((chip) => {
      const tok = Number(chip.dataset.tok);
      chip.classList.toggle("placed", state.placedFlags[tok]);
    });
  }

  document.querySelectorAll("#word-bank .chip").forEach((chip) => {
    chip.onclick = () => {
      if (state.answered) return;
      const tok = Number(chip.dataset.tok);
      if (state.placedFlags[tok]) return;
      state.placedFlags[tok] = true;
      state.buildZone.push(tok);
      refreshZone();
      refreshBank();
    };
  });

  document.getElementById("clear-btn").onclick = () => {
    if (state.answered) return;
    state.buildZone = [];
    state.placedFlags = item.tokens.map(() => false);
    refreshZone();
    refreshBank();
  };

  document.getElementById("check-btn").onclick = () => {
    if (state.answered) return;
    state.answered = true;
    const correctOrder = item.tokens.map((_, i) => i);
    const isCorrect =
      state.buildZone.length === correctOrder.length &&
      state.buildZone.every((v, i) => v === correctOrder[i]);

    if (isCorrect) state.score++;

    document.getElementById("check-btn").disabled = true;
    document.getElementById("clear-btn").disabled = true;

    document.getElementById("feedback").textContent = isCorrect
      ? "Correct! 🎉"
      : "Close — here's the correct order. Tap 📖 Explain for the breakdown.";
    document.getElementById("feedback").className = "feedback " + (isCorrect ? "correct" : "wrong");

    if (!isCorrect) {
      state.buildZone = correctOrder;
      refreshZone();
    }

    document.getElementById("next-row").innerHTML = `<button class="btn-primary" id="next-btn">Next →</button>`;
    document.getElementById("next-btn").onclick = () => {
      state.pos++;
      renderStandaloneItem();
    };

    document.getElementById("score").textContent = `Score: ${state.score}`;
  };

  refreshZone();
}

function renderStandaloneDone() {
  setBestIfBetter(state.deck.id, state.score, state.order.length);
  document.getElementById("progress").textContent = `${state.deck.title} · Finished`;
  document.getElementById("progress-fill").style.width = "100%";
  document.getElementById("score").textContent = `Score: ${state.score}`;
  appEl.querySelector("#exercise").innerHTML = `
    <div class="card done-card">
      <div class="big">🎉</div>
      <h2>Deck complete</h2>
      <p>You scored ${state.score} / ${state.order.length}</p>
      <div class="actions-row">
        <button class="btn-secondary" id="home-btn">Back to decks</button>
        <button class="btn-primary" id="restart-btn">Play again</button>
      </div>
    </div>
  `;
  document.getElementById("home-btn").onclick = renderHome;
  document.getElementById("restart-btn").onclick = () => {
    state.order = shuffle(state.deck.items.map((_, i) => i));
    state.pos = 0;
    state.score = 0;
    renderStandaloneItem();
  };
}

// ================================================================
// CONVERSATION DECK
// ================================================================
function startConversation(deck) {
  state.turnIndex = 0;
  state.revealedTurns = [];
  state.compIndex = 0;
  state.compScore = 0;
  renderConversationStep(deck);
}

function updateConversationHeader(deck, label) {
  document.getElementById("progress").textContent = `${deck.title} · ${label}`;
  document.getElementById("score").textContent = "";
  document.getElementById("progress-bar-wrap").hidden = true;
}

function turnBubbleHtml(turn, idx) {
  const side = turn.align === "right" ? "bubble-right" : "bubble-left";
  return `
    <div class="bubble ${side}">
      <div class="bubble-speaker">${turn.speaker}</div>
      <div class="bubble-thai">${turn.thai}</div>
      <div class="bubble-translit">${turn.translit}</div>
      <div class="bubble-english hidden" id="bubble-en-${idx}">${turn.english}</div>
      <div class="bubble-actions">
        <button class="btn-audio small" data-bubble-play="${idx}">🔊</button>
        <button class="btn-audio small" data-bubble-explain="${idx}">📖</button>
        <button class="btn-audio small" data-bubble-toggle="${idx}">👁 Meaning</button>
      </div>
    </div>`;
}

function renderConversationStep(deck) {
  const allShown = state.turnIndex >= deck.turns.length;
  updateConversationHeader(
    deck,
    allShown ? "Ready for the quiz" : `Line ${state.turnIndex + 1} of ${deck.turns.length}`
  );

  appEl.querySelector("#exercise").innerHTML = `
    <div class="card">
      ${sceneHtml(deck.title, deck.cover)}
      <div class="scene-note">${deck.scene}</div>
      <div class="thread" id="thread">
        ${state.revealedTurns.map((t, i) => turnBubbleHtml(t, i)).join("")}
      </div>
      <div class="next-row">
        ${
          allShown
            ? `<button class="btn-primary" id="start-comp-btn">Answer questions →</button>`
            : `<button class="btn-primary" id="continue-btn">Continue ▾</button>`
        }
      </div>
    </div>
  `;

  wireThreadBubbles();

  if (allShown) {
    document.getElementById("start-comp-btn").onclick = () => renderComprehension(deck);
  } else {
    document.getElementById("continue-btn").onclick = () => {
      state.revealedTurns.push(deck.turns[state.turnIndex]);
      state.turnIndex++;
      renderConversationStep(deck);
    };
  }

  const thread = document.getElementById("thread");
  thread.scrollTop = thread.scrollHeight;
}

function wireThreadBubbles() {
  document.querySelectorAll("[data-bubble-play]").forEach((btn) => {
    btn.onclick = () => {
      const t = state.revealedTurns[Number(btn.dataset.bubblePlay)];
      speak(t.thai, "th-TH");
    };
  });
  document.querySelectorAll("[data-bubble-explain]").forEach((btn) => {
    btn.onclick = () => openExplain(state.revealedTurns[Number(btn.dataset.bubbleExplain)]);
  });
  document.querySelectorAll("[data-bubble-toggle]").forEach((btn) => {
    btn.onclick = () => {
      document.getElementById(`bubble-en-${btn.dataset.bubbleToggle}`).classList.toggle("hidden");
    };
  });
}

function renderComprehension(deck) {
  if (state.compIndex >= deck.comprehension.length) {
    renderConversationDone(deck);
    return;
  }
  const q = deck.comprehension[state.compIndex];
  updateConversationHeader(deck, `Quiz ${state.compIndex + 1} of ${deck.comprehension.length}`);

  appEl.querySelector("#exercise").innerHTML = `
    <div class="card">
      ${sceneHtml(deck.title + " · Quiz", deck.cover)}
      <div class="prompt-text" style="padding-top:20px; font-size:1.05rem;">${q.prompt}</div>
      <div class="options" id="options">
        ${q.options.map((opt, i) => `<button class="option-btn" data-idx="${i}">${opt}</button>`).join("")}
      </div>
      <div class="feedback" id="feedback"></div>
      <div class="next-row" id="next-row"></div>
    </div>
  `;

  document.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.idx);
      const correct = idx === q.correctIndex;
      if (correct) state.compScore++;

      document.querySelectorAll(".option-btn").forEach((b, i) => {
        b.disabled = true;
        if (i === q.correctIndex) b.classList.add("correct");
        else if (i === idx && !correct) b.classList.add("wrong");
      });

      document.getElementById("feedback").textContent = correct ? "Correct! 🎉" : "Not quite.";
      document.getElementById("feedback").className = "feedback " + (correct ? "correct" : "wrong");

      document.getElementById("next-row").innerHTML = `<button class="btn-primary" id="next-btn">Next →</button>`;
      document.getElementById("next-btn").onclick = () => {
        state.compIndex++;
        renderComprehension(deck);
      };
    };
  });
}

function renderConversationDone(deck) {
  setBestIfBetter(deck.id, state.compScore, deck.comprehension.length);
  document.getElementById("progress").textContent = `${deck.title} · Finished`;
  appEl.querySelector("#exercise").innerHTML = `
    <div class="card done-card">
      <div class="big">🎉</div>
      <h2>Conversation complete</h2>
      <p>Quiz score: ${state.compScore} / ${deck.comprehension.length}</p>
      <div class="actions-row">
        <button class="btn-secondary" id="home-btn">Back to decks</button>
        <button class="btn-primary" id="restart-btn">Play again</button>
      </div>
    </div>
  `;
  document.getElementById("home-btn").onclick = renderHome;
  document.getElementById("restart-btn").onclick = () => startConversation(deck);
}

// ---------------- boot ----------------
renderHome();
