import { Phase, RULES, activePlayers, canBuzz, createGame, orderedResults, reduceGame } from "./domain.js";
import "./styles.css";

const app = document.querySelector("#app");
let game = null;
let view = "home";
let playerName = localStorage.getItem("qroom-player") || "プレイヤー";
let selectedPlayerId = null;
const QUESTION_SECONDS = 20;
let timerRemaining = QUESTION_SECONDS;
let timerDeadline = 0;
let clockInterval = null;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dispatch = (action) => {
  game = reduceGame(game, action);
  if (game.phase === Phase.QUESTION && clockInterval === null) {
    timerDeadline = Date.now() + QUESTION_SECONDS * 1000;
    timerRemaining = QUESTION_SECONDS;
    clockInterval = window.setInterval(() => {
      timerRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
      if (timerRemaining <= 0) {
        window.clearInterval(clockInterval); clockInterval = null;
        dispatch({ type: "NO_ANSWER" });
      } else render();
    }, 1000);
  } else if (game.phase !== Phase.QUESTION && clockInterval !== null) {
    window.clearInterval(clockInterval); clockInterval = null;
  }
  render();
};

function renderHome() {
  app.innerHTML = `<main class="home-shell"><header class="brand"><span class="brand-mark">Q</span><div><strong>Q-Room <span>Pro</span></strong><small>競技クイズルーム</small></div></header><section class="hero"><div class="eyebrow">FAST · FAIR · FOCUSED</div><h1>クイズに、<br><em>集中しよう。</em></h1><p>早押しからスコア管理まで。ゲームの進行を、ひとつのルームに。</p><button class="primary large" data-action="create">ルームを作成 <span>→</span></button><div class="hero-note"><span class="pulse"></span> セットアップはすぐに完了</div></section><section class="feature-row"><div><b>01</b><span>瞬時に反応する<br>早押しボタン</span></div><div><b>02</b><span>ルールに沿った<br>スコア管理</span></div><div><b>03</b><span>司会もプレイヤーも<br>同じルームで</span></div></section><footer>Q-ROOM PRO <span>EARLY MVP</span></footer></main>`;
}

function renderSetup() {
  app.innerHTML = `<main class="setup-shell"><button class="back" data-action="home">← ホーム</button><div class="eyebrow">NEW GAME · 01</div><h1>ルームを<br>作成する</h1><form id="setup-form" class="setup-form"><label>ルーム名<input name="room" maxlength="40" placeholder="例：水曜夜の練習会" value="今日のクイズ" required /></label><label>ゲームルール<select name="rule"><option value="sevenThree">7○3× — 7問正解で勝利、3回誤答で失格</option><option value="tenByTen">10by10 — 10問正解で勝利</option></select></label><label>プレイヤー名 <small>改行区切りで入力</small><textarea name="players" rows="4" maxlength="240">${esc(playerName)}&#10;Player 2</textarea></label><button class="primary large" type="submit">ルームを作成 <span>→</span></button></form></main>`;
  document.querySelector("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const names = String(data.get("players")).split("\n").map((name) => name.trim()).filter(Boolean).slice(0, 12);
    if (!names.length) return;
    playerName = names[0]; localStorage.setItem("qroom-player", playerName);
    game = createGame({ roomName: data.get("room"), ruleId: data.get("rule"), names }); selectedPlayerId = game.players[0]?.id ?? null; view = "room"; render();
  });
}

function playerCard(player, index) {
  const buzzed = game.buzzedPlayerId === player.id;
  return `<article class="player-card ${buzzed ? "is-buzzed" : ""} ${player.eliminated ? "is-out" : ""}"><div class="player-meta"><span class="player-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(player.name)}</strong>${player.eliminated ? '<span class="out-tag">OUT</span>' : player.penalty ? '<span class="penalty-tag">PENALTY</span>' : ""}</div><div class="player-stats"><b>${player.score}<small>点</small></b><span>${player.correct} <i>○</i></span><span>${player.incorrect} <i class="cross">×</i></span></div><button class="buzz-button" data-action="buzz" data-id="${player.id}" ${!canBuzz(game, player.id) ? "disabled" : ""} aria-label="${esc(player.name)} 早押し">${buzzed ? "BUZZED" : player.eliminated ? "失格" : game.phase === Phase.QUESTION ? "BUZZ" : "WAIT"}</button></article>`;
}

function renderRoom() {
  const host = `<header class="room-header"><a class="brand compact" href="#" data-action="home"><span class="brand-mark">Q</span><strong>Q-Room <span>Pro</span></strong></a><div class="room-header-actions"><div class="room-code"><small>ROOM CODE</small><b>${game.roomId}</b></div><button class="secondary mode-button" data-action="player-view">プレイヤー画面</button><button class="icon-button" data-action="fullscreen" title="全画面表示">⛶</button></div></header>`;
  const controls = game.phase === Phase.READY && game.question === 0
    ? `<button class="primary" data-action="start">ゲーム開始 <span>→</span></button>`
    : game.phase === Phase.BUZZED ? `<button class="judge correct" data-action="correct">○ 正解</button><button class="judge incorrect" data-action="incorrect">× 不正解</button>`
      : game.phase === Phase.READY ? `<button class="primary" data-action="next">次の問題 <span>→</span></button>`
        : game.phase === Phase.FINISHED ? `<button class="primary" data-action="reset">もう一度プレイ</button>` : `<button class="secondary" disabled>出題中 · 早押し受付中</button><button class="text-button skip-question" data-action="no-answer">回答なし</button>`;
  app.innerHTML = `<main class="room-shell">${host}<div class="room-content"><section class="room-title"><div><div class="eyebrow">${esc(RULES[game.ruleId].name)} · QUESTION ${String(game.question).padStart(2, "0")}</div><h1>${esc(game.roomName)}</h1></div><span class="phase-pill ${game.phase}"><i></i>${esc(game.message)}</span></section><section class="host-panel"><div class="host-panel-top"><div><small>GAME CONTROL</small><h2>${game.phase === Phase.BUZZED ? "回答者を判定" : game.phase === Phase.FINISHED ? "ゲーム結果" : "司会コントロール"}</h2></div><span class="host-round">${game.phase === Phase.QUESTION ? `<span class="countdown ${timerRemaining <= 5 ? "urgent" : ""}" aria-label="残り${timerRemaining}秒">${String(timerRemaining).padStart(2, "0")}<small>SEC</small></span>` : game.question ? `Q ${game.question}` : "LOBBY"}</span></div><div class="host-actions">${controls}<span class="host-hint">${game.phase === Phase.BUZZED ? "判定後、次の問題へ進めます" : game.phase === Phase.QUESTION ? "残り時間内に早押しするか、回答なしで次問へ進みます" : "問題を読み上げて、プレイヤーの早押しを待ちます"}</span></div></section><section class="players-section"><div class="section-heading"><div><small>PLAYERS</small><h2>プレイヤー <span>${activePlayers(game).length}/${game.players.length}</span></h2></div><button class="text-button" data-action="end">ゲーム終了</button></div><div class="player-grid">${game.players.map(playerCard).join("")}</div></section>${game.phase === Phase.FINISHED ? `<section class="results"><div class="eyebrow">FINAL RESULTS</div><h2>ゲーム結果</h2><div>${orderedResults(game).map((p, i) => `<p><b>${String(i + 1).padStart(2, "0")}</b> ${esc(p.name)} <span>${p.score}点 · ${p.correct}○ ${p.incorrect}×</span></p>`).join("")}</div></section>` : ""}</div></main>`;
}

function renderPlayer() {
  const player = game.players.find((item) => item.id === selectedPlayerId) ?? game.players[0];
  if (!player) { view = "room"; renderRoom(); return; }
  selectedPlayerId = player.id;
  const canPress = canBuzz(game, player.id);
  const label = game.phase === Phase.FINISHED ? "ゲーム終了" : player.eliminated ? "失格" : game.phase === Phase.BUZZED ? game.buzzedPlayerId === player.id ? "あなたの回答です" : "回答受付終了" : canPress ? "問題を聞いて、わかったら押す" : game.phase === Phase.READY ? "次の問題を待っています" : "出題中";
  app.innerHTML = `<main class="player-shell ${canPress ? "accepting" : ""}"><header class="player-header"><a class="brand compact" href="#" data-action="host-view"><span class="brand-mark">Q</span><strong>Q-Room <span>Pro</span></strong></a><button class="text-button" data-action="host-view">司会画面へ ↗</button></header><section class="player-main"><div class="player-game-meta"><span class="eyebrow">${esc(game.roomName)} · ${RULES[game.ruleId].name}</span><span>QUESTION ${String(game.question).padStart(2, "0")}</span></div><label class="player-select-label">PLAYER<select id="player-select">${game.players.map((item) => `<option value="${item.id}" ${item.id === player.id ? "selected" : ""}>${esc(item.name)}${item.eliminated ? "（失格）" : ""}</option>`).join("")}</select></label><div class="player-scoreline"><div><strong>${esc(player.name)}</strong><span>${player.correct} ○ <i>${player.incorrect} ×</i></span></div><b>${player.score}<small>PTS</small></b></div><button class="player-buzz ${canPress ? "ready" : ""} ${game.buzzedPlayerId === player.id ? "won" : ""}" data-action="buzz" data-id="${player.id}" ${canPress ? "" : "disabled"}><span>${canPress ? "BUZZ" : game.buzzedPlayerId === player.id ? "BUZZED" : "WAIT"}</span><small>${canPress ? "TAP TO ANSWER" : esc(label)}</small></button><div class="player-state"><span class="state-dot ${game.phase}"></span>${esc(label)}${game.phase === Phase.QUESTION ? `<b class="player-time">${timerRemaining}s</b>` : ""}</div></section><footer class="player-footer"><span>Q-ROOM PRO</span><span>${game.roomId}</span></footer></main>`;
}

function render() { view === "home" ? renderHome() : view === "setup" ? renderSetup() : view === "player" ? renderPlayer() : renderRoom(); }

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (action === "home") { event.preventDefault(); view = "home"; render(); }
  if (action === "create") { view = "setup"; render(); }
  if (action === "start") dispatch({ type: "START" });
  if (action === "next") dispatch({ type: "NEXT" });
  if (action === "correct") dispatch({ type: "JUDGE", correct: true });
  if (action === "incorrect") dispatch({ type: "JUDGE", correct: false });
  if (action === "no-answer") dispatch({ type: "NO_ANSWER" });
  // Pointer users are handled on pointerdown; this fallback supports assistive click activation.
  if (action === "buzz" && event.detail === 0) { if (navigator.vibrate) navigator.vibrate(18); dispatch({ type: "BUZZ", playerId: id }); }
  if (action === "end") dispatch({ type: "END" });
  if (action === "reset") dispatch({ type: "RESET" });
  if (action === "fullscreen") document.documentElement.requestFullscreen?.();
  if (action === "player-view") { view = "player"; render(); }
  if (action === "host-view") { event.preventDefault(); view = "room"; render(); }
});

app.addEventListener("change", (event) => {
  if (event.target.id === "player-select") { selectedPlayerId = event.target.value; render(); }
});

app.addEventListener("pointerdown", (event) => {
  const button = event.target.closest(".buzz-button:not(:disabled)");
  if (!button) return;
  button.classList.add("pressed");
  if (navigator.vibrate) navigator.vibrate(18);
  dispatch({ type: "BUZZ", playerId: button.dataset.id });
});
app.addEventListener("pointerup", () => document.querySelectorAll(".buzz-button.pressed").forEach((button) => button.classList.remove("pressed")));
window.addEventListener("keydown", (event) => {
  if ((view !== "room" && view !== "player") || event.repeat || event.target.matches("input,textarea,select")) return;
  if (view === "player") {
    if (event.code === "Space" && selectedPlayerId && canBuzz(game, selectedPlayerId)) dispatch({ type: "BUZZ", playerId: selectedPlayerId });
    return;
  }
  const index = Number(event.key) - 1;
  if (index >= 0 && game.players[index] && canBuzz(game, game.players[index].id)) dispatch({ type: "BUZZ", playerId: game.players[index].id });
});

render();
