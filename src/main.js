import { Phase, activePlayers, buzzDelayRemaining, canBuzz, orderedResults, reduceGame, ruleForGame } from "./domain.js";
import { buzzFeedback, canRequestFullscreen, exitNativeApp, getLaunchUrl, onAppResume, onAppUrlOpen, onNativeBackButton, openRoomEvents, playSoundCue, primeSound, readPreference, removePreference, request, requestFullscreen, setScreenAwake, shareRoomCode, writePreference } from "./platform.js";

const app = document.querySelector("#app");
if ("serviceWorker" in navigator && !globalThis.QROOM_PLATFORM?.isNative && !globalThis.Capacitor?.isNativePlatform?.()) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}), { once: true });
}
let game = null;
let view = "home";
let playerName = "プレイヤー";
let soundEnabled = true;
const validRoomCode = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;
function roomCodeFromUrl(value) {
  try {
    const code = new URL(value, globalThis.location.origin).searchParams.get("room")?.toUpperCase() || "";
    return validRoomCode.test(code) ? code : "";
  } catch { return ""; }
}
let pendingRoomCode = roomCodeFromUrl(globalThis.location.href);
let session = null;
let eventSource = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let connectionState = "disconnected";
let notice = "";
let currentVersion = 0;
let canUndo = false;
let undoCount = 0;
const QUESTION_SECONDS = 20;
function currentQuestionStartAt() { return timerDeadline ? timerDeadline - QUESTION_SECONDS * 1000 : 0; }
let timerRemaining = QUESTION_SECONDS;
let timerDeadline = 0;
let clockInterval = null;
let delayRefreshTimer = null;
const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
async function api(path, body, token) {
  let response;
  try {
    // An empty API base intentionally targets the current origin. This supports
    // the combined server deployment and lets browser users try the app even
    // when a separate API origin has not been injected at build time.
    response = await request(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  } catch {
    throw new Error("サーバーに接続できません。APIの起動状態と接続先設定を確認してください。");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "通信に失敗しました");
  return result;
}

function applySnapshot(snapshot) {
  if (snapshot.version < currentVersion) return;
  const previousGame = game;
  const priorBuzzedPlayerId = previousGame?.buzzedPlayerId;
  currentVersion = snapshot.version;
  game = snapshot.game;
  canUndo = Boolean(snapshot.canUndo);
  undoCount = Number.isInteger(snapshot.undoCount) ? snapshot.undoCount : Number(canUndo);
  if (soundEnabled && previousGame && (view === "room" || view === "player")) {
    if (game.buzzedPlayerId && game.buzzedPlayerId !== priorBuzzedPlayerId) playSoundCue("buzz");
    else if (previousGame.phase === Phase.BUZZED && game.phase !== Phase.BUZZED) {
      if (game.message.startsWith("正解")) playSoundCue("correct");
      else if (game.message.startsWith("不正解")) playSoundCue("incorrect");
    }
  }
  void setScreenAwake(Boolean(session) && game.phase !== Phase.FINISHED);
  timerDeadline = snapshot.questionDeadline || 0;
  timerRemaining = timerDeadline ? Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)) : 0;
  if (timerDeadline && clockInterval === null) clockInterval = window.setInterval(() => {
    timerRemaining = Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000));
    render();
  }, 1000);
  if (!timerDeadline && clockInterval !== null) { window.clearInterval(clockInterval); clockInterval = null; }
  render();
}

async function connectRoom(snapshot, newSession, nextView) {
  currentVersion = 0;
  session = newSession;
  connectionState = "connecting";
  notice = "";
  await writePreference("qroom-session", JSON.stringify(session));
  view = nextView;
  applySnapshot(snapshot);
  if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (eventSource) eventSource.close();
  connectRoomEvents();
}

function connectRoomEvents() {
  if (!session) return;
  const source = openRoomEvents(session.roomId);
  eventSource = source;
  source.onopen = () => {
    if (eventSource !== source) return;
    connectionState = "connected";
    if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (notice) notice = "";
    render();
  };
  source.onmessage = (event) => {
    if (eventSource !== source) return;
    if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
    reconnectAttempts = 0;
    notice = "";
    applySnapshot(JSON.parse(event.data));
  };
  source.onerror = () => {
    if (eventSource !== source) return;
    connectionState = navigator.onLine ? "reconnecting" : "offline";
    notice = connectionState === "offline" ? "オフラインです。接続が戻ると自動で再接続します。" : "再接続中… · ネットワークを確認してください";
    render();
    if (reconnectTimer === null) {
      const baseDelay = Math.min(30_000, 3_000 * (2 ** Math.min(reconnectAttempts++, 4)));
      const retryDelay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
      reconnectTimer = window.setTimeout(async () => {
        reconnectTimer = null;
        const activeSession = session;
        if (!activeSession) return;
        await refreshRoom();
        if (session === activeSession) {
          eventSource?.close();
          connectRoomEvents();
        }
      }, retryDelay);
    }
  };
}

async function dispatch(action) {
  if (!session || !game) return;
  const dispatchedAction = action.type === "BUZZ" ? { ...action, now: Date.now(), questionStartAt: currentQuestionStartAt() } : action;
  const prior = game;
  const expectedVersion = currentVersion;
  const optimistic = reduceGame(prior, dispatchedAction);
  if (optimistic !== prior) { game = optimistic; render(); }
  notice = "";
  try {
    const body = { action: dispatchedAction, version: expectedVersion, ...(session.role === "player" ? { playerToken: session.token } : {}) };
    await api(`/api/rooms/${session.roomId}/actions`, body, session.role === "host" ? session.token : undefined);
  } catch (error) {
    notice = error.message;
    try { applySnapshot(await api(`/api/rooms/${session.roomId}`)); } catch { /* Keep the last known state while reconnecting. */ }
    render();
  }
}

function renderHome() {
  app.innerHTML = `<main class="home-shell"><header class="brand"><span class="brand-mark">Q</span><div><strong>Q-Room <span>Pro</span></strong><small>競技クイズルーム</small></div></header><section class="hero"><div class="eyebrow">FAST · FAIR · FOCUSED</div><h1>クイズに、<br><em>集中しよう。</em></h1><p>早押しからスコア管理まで。ゲームの進行を、ひとつのルームに。</p>${notice ? `<div class="connection-notice" role="status">${esc(notice)}</div>` : ""}<button class="primary large" data-action="create">ルームを作成 <span>→</span></button><button class="secondary large join-entry" data-action="join-view">ルームに参加 <span>↗</span></button><div class="hero-note"><span class="pulse"></span> ルームコードで参加 · 同期はリアルタイム</div></section><section class="feature-row"><div><b>01</b><span>瞬時に反応する<br>早押しボタン</span></div><div><b>02</b><span>ルールに沿った<br>スコア管理</span></div><div><b>03</b><span>司会もプレイヤーも<br>同じルームで</span></div></section><footer>Q-ROOM PRO <span>EARLY MVP</span></footer></main>`;
}

function renderSetup() {
  app.innerHTML = `<main class="setup-shell"><button class="back" data-action="home">← ホーム</button><div class="eyebrow">NEW GAME · 01</div><h1>ルームを<br>作成する</h1><form id="setup-form" class="setup-form"><label>ルーム名<input name="room" maxlength="40" placeholder="例：水曜夜の練習会" value="今日のクイズ" required /></label><label>ゲームルール<select name="rule" id="rule-select"><option value="sevenThree">7○3× — 7問正解で勝利、3回誤答で失格</option><option value="tenByTen">10by10 — 10問正解で勝利</option><option value="custom">n○m× — 正解数・失格数を指定</option></select></label><div class="custom-rule-fields" id="custom-rule-fields" hidden><label>勝利に必要な正解数<input name="winBy" type="number" min="1" max="50" value="7" required disabled /></label><label>失格となる誤答数<input name="missLimit" type="number" min="1" max="20" value="3" required disabled /></label><p class="form-note">正解数は1〜50、誤答数は1〜20で指定できます。</p></div><p class="form-note">作成後に表示されるルームコードをプレイヤーへ共有してください。</p><button class="primary large" type="submit">ルームを作成 <span>→</span></button><p class="form-error" role="alert">${esc(notice)}</p></form></main>`;
  const ruleSelect = document.querySelector("#rule-select");
  const customRuleFields = document.querySelector("#custom-rule-fields");
  const updateCustomRuleFields = () => {
    const enabled = ruleSelect.value === "custom";
    customRuleFields.hidden = !enabled;
    customRuleFields.querySelectorAll("input").forEach((input) => { input.disabled = !enabled; });
  };
  ruleSelect.addEventListener("change", updateCustomRuleFields);
  updateCustomRuleFields();
  document.querySelector("#setup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (soundEnabled) primeSound();
    const data = new FormData(event.currentTarget);
    const ruleId = data.get("rule");
    const customRule = ruleId === "custom" ? { winBy: Number(data.get("winBy")), missLimit: Number(data.get("missLimit")) } : {};
    void api("/api/rooms", { roomName: data.get("room"), ruleId, ...customRule }).then(async (result) => {
      notice = "";
      await connectRoom(result, { roomId: result.game.roomId, role: "host", token: result.hostToken }, "room");
    }).catch((error) => { notice = error.message; renderSetup(); });
  });
}

function renderJoin() {
  app.innerHTML = `<main class="setup-shell"><button class="back" data-action="home">← ホーム</button><div class="eyebrow">JOIN A ROOM · 01</div><h1>ゲームに<br>参加する</h1><form id="join-form" class="setup-form"><label>ルームコード<input name="code" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="例：A2BC34DE" value="${esc(pendingRoomCode)}" required /></label><label>プレイヤー名<input name="name" maxlength="24" autocomplete="name" value="${esc(playerName)}" required /></label><button class="primary large" type="submit">参加する <span>→</span></button><p class="form-error" role="alert">${esc(notice)}</p></form></main>`;
  document.querySelector("#join-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (soundEnabled) primeSound();
    const data = new FormData(event.currentTarget);
    const roomId = String(data.get("code")).trim().toUpperCase();
    const name = String(data.get("name")).trim();
    void api(`/api/rooms/${encodeURIComponent(roomId)}/join`, { name }).then(async (result) => {
      playerName = name; await writePreference("qroom-player", name); notice = "";
      pendingRoomCode = "";
      await connectRoom(result, { roomId, role: "player", token: result.playerToken, playerId: result.playerId }, "player");
    }).catch((error) => { notice = error.message; renderJoin(); });
  });
}

function playerCard(player, index) {
  const buzzed = game.buzzedPlayerId === player.id;
  const delayRemaining = game.phase === Phase.QUESTION ? buzzDelayRemaining(game, player.id, currentQuestionStartAt()) : 0;
  const status = player.eliminated ? "失格" : buzzed ? "回答者" : player.penalty ? "回答済み" : delayRemaining > 0 ? `Delay · ${Math.ceil(delayRemaining / 1000)}秒` : game.phase === Phase.QUESTION ? "受付中" : "待機中";
  const hostCanEditDelay = session?.role === "host" && game.phase === Phase.READY && game.question === 0;
  return `<article class="player-card ${buzzed ? "is-buzzed" : ""} ${player.eliminated ? "is-out" : ""}"><div class="player-meta"><span class="player-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(player.name)}</strong>${player.eliminated ? '<span class="out-tag">OUT</span>' : player.penalty ? '<span class="penalty-tag">PENALTY</span>' : player.delaySeconds ? `<span class="delay-tag">DELAY ${player.delaySeconds}s</span>` : ""}</div><div class="player-stats"><b>${player.score}<small>点</small></b><span>${player.correct} <i>○</i></span><span>${player.incorrect} <i class="cross">×</i></span>${session?.role === "host" ? `<button class="score-edit" data-action="edit-score" data-id="${player.id}" aria-label="${esc(player.name)}の得点を修正">修正</button>${hostCanEditDelay ? `<button class="score-edit" data-action="edit-delay" data-id="${player.id}" aria-label="${esc(player.name)}の早押しDelayを設定">Delay</button>` : ""}` : ""}</div><div class="host-player-status">${status}</div></article>`;
}

function connectionLabel(state) {
  return ({ connected: "接続済み", connecting: "接続中", reconnecting: "再接続中", offline: "オフライン", disconnected: "切断" })[state] || "接続状態不明";
}

function renderRoom() {
  const rule = ruleForGame(game);
  const host = `<header class="room-header"><div class="brand compact"><span class="brand-mark">Q</span><strong>Q-Room <span>Pro</span></strong></div><div class="room-header-actions"><span class="connection-status ${connectionState}" role="status"><i></i>${connectionLabel(connectionState)}</span><div class="room-code"><small>ROOM CODE</small><b>${game.roomId}</b></div><button class="secondary mode-button" data-action="copy-code">参加リンクを共有</button><button class="icon-button sound-toggle" data-action="sound-toggle" aria-label="効果音${soundEnabled ? "をオフ" : "をオン"}" title="効果音">${soundEnabled ? "♫" : "♪̸"}</button>${canRequestFullscreen() ? '<button class="icon-button" data-action="fullscreen" title="全画面表示">⛶</button>' : ""}</div></header>`;
  const controls = game.phase === Phase.READY && game.question === 0
    ? `<button class="primary" data-action="start" ${game.players.length ? "" : "disabled"}>ゲーム開始 <span>→</span></button>`
    : game.phase === Phase.BUZZED ? `<button class="judge correct" data-action="correct">○ 正解</button><button class="judge incorrect" data-action="incorrect">× 不正解</button>`
      : game.phase === Phase.READY ? `<button class="primary" data-action="next">次の問題 <span>→</span></button>`
        : game.phase === Phase.FINISHED ? `<button class="primary" data-action="reset">もう一度プレイ</button>` : `<button class="secondary" disabled>出題中 · 早押し受付中</button><button class="text-button skip-question" data-action="no-answer">回答なし</button>`;
  app.innerHTML = `<main class="room-shell">${host}<div class="room-content"><section class="room-title"><div><div class="eyebrow">${esc(rule.name)} · QUESTION ${String(game.question).padStart(2, "0")}</div><h1>${esc(game.roomName)}</h1></div><span class="phase-pill ${game.phase}"><i></i>${esc(game.message)}</span></section>${notice ? `<div class="connection-notice" role="status">${esc(notice)}</div>` : ""}<section class="host-panel"><div class="host-panel-top"><div><small>GAME CONTROL</small><h2>${game.phase === Phase.BUZZED ? "回答者を判定" : game.phase === Phase.FINISHED ? "ゲーム結果" : game.question === 0 ? "参加者を待っています" : "司会コントロール"}</h2></div><span class="host-round">${game.phase === Phase.QUESTION ? `<span class="countdown ${timerRemaining <= 5 ? "urgent" : ""}" aria-label="残り${timerRemaining}秒">${String(timerRemaining).padStart(2, "0")}<small>SEC</small></span>` : game.question ? `Q ${game.question}` : "LOBBY"}</span></div><div class="host-actions">${controls}${canUndo && session?.role === "host" ? `<button class="secondary undo-button" data-action="undo">↶ Undo (${undoCount})</button>` : ""}<span class="host-hint">${game.phase === Phase.BUZZED ? "判定後、次の問題へ進めます" : game.phase === Phase.QUESTION ? "残り時間内に早押しするか、回答なしで次問へ進みます" : game.question === 0 ? "ルームコードを共有し、プレイヤーの参加を待ちます" : "問題を読み上げて、プレイヤーの早押しを待ちます"}</span><span class="keyboard-hint" aria-label="キーボードショートカット">1 正解 · 2 不正解 · N 次問 · U 取り消し</span></div></section><section class="players-section"><div class="section-heading"><div><small>PLAYERS</small><h2>プレイヤー <span>${activePlayers(game).length}/${game.players.length}</span></h2></div>${game.phase !== Phase.FINISHED ? `<button class="text-button" data-action="end">ゲーム終了</button>` : ""}</div><div class="player-grid">${game.players.map(playerCard).join("") || `<p class="empty-players">ルームコードを共有すると、参加者がここに表示されます。</p>`}</div></section>${game.phase === Phase.FINISHED ? `<section class="results"><div class="eyebrow">FINAL RESULTS</div><h2>ゲーム結果</h2><div>${orderedResults(game).map((p, i) => `<p><b>${String(i + 1).padStart(2, "0")}</b> ${esc(p.name)} <span>${p.score}点 · ${p.correct}○ ${p.incorrect}×</span></p>`).join("")}</div></section>` : ""}</div></main>`;
}

function renderPlayer() {
  const player = game.players.find((item) => item.id === session?.playerId);
  if (!player) { view = "home"; renderHome(); return; }
  const rule = ruleForGame(game);
  const canPress = canBuzz(game, player.id, Date.now(), currentQuestionStartAt());
  const delayRemaining = buzzDelayRemaining(game, player.id, currentQuestionStartAt());
  if (delayRefreshTimer !== null) { window.clearTimeout(delayRefreshTimer); delayRefreshTimer = null; }
  if (delayRemaining > 0) delayRefreshTimer = window.setTimeout(() => { delayRefreshTimer = null; render(); }, delayRemaining + 5);
  const label = game.phase === Phase.FINISHED ? "ゲーム終了" : player.eliminated ? "失格" : game.phase === Phase.BUZZED ? game.buzzedPlayerId === player.id ? "あなたの回答です" : "回答受付終了" : delayRemaining > 0 ? `早押し受付まで ${Math.ceil(delayRemaining / 1000)}秒` : canPress ? "問題を聞いて、わかったら押す" : game.phase === Phase.READY ? "次の問題を待っています" : "出題中";
  app.innerHTML = `<main class="player-shell ${canPress ? "accepting" : ""}"><header class="player-header"><a class="brand compact" href="#" data-action="leave-room"><span class="brand-mark">Q</span><strong>Q-Room <span>Pro</span></strong></a><div class="player-header-actions"><span class="connection-status ${connectionState}" role="status"><i></i>${connectionLabel(connectionState)}</span><span class="room-code"><small>ROOM</small><b>${game.roomId}</b></span><button class="icon-button sound-toggle" data-action="sound-toggle" aria-label="効果音${soundEnabled ? "をオフ" : "をオン"}" title="効果音">${soundEnabled ? "♫" : "♪̸"}</button></div></header><section class="player-main"><div class="player-game-meta"><span class="eyebrow">${esc(game.roomName)} · ${esc(rule.name)}</span><span>QUESTION ${String(game.question).padStart(2, "0")}</span></div><div class="player-select-label">PLAYER</div><div class="player-scoreline"><div><strong>${esc(player.name)}</strong><span>${player.correct} ○ <i>${player.incorrect} ×</i></span></div><b>${player.score}<small>PTS</small></b></div>${notice ? `<div class="connection-notice" role="status">${esc(notice)}</div>` : ""}<button class="player-buzz ${canPress ? "ready" : ""} ${game.buzzedPlayerId === player.id ? "won" : ""}" data-action="buzz" data-id="${player.id}" ${canPress ? "" : "disabled"}><span>${canPress ? "BUZZ" : game.buzzedPlayerId === player.id ? "BUZZED" : "WAIT"}</span><small>${canPress ? "TAP TO ANSWER" : esc(label)}</small></button><div class="player-state"><span class="state-dot ${game.phase}"></span>${esc(label)}${game.phase === Phase.QUESTION ? `<b class="player-time">${timerRemaining}s</b>` : ""}</div></section><footer class="player-footer"><span>Q-ROOM PRO</span><button class="text-button" data-action="leave-room">ルームを退出</button></footer></main>`;
}

function render() {
  view === "home" ? renderHome() : view === "setup" ? renderSetup() : view === "join" ? renderJoin() : view === "player" ? renderPlayer() : renderRoom();
  app.dataset.ready = "true";
}

app.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]"); if (!button) return;
  const { action, id } = button.dataset;
  if (soundEnabled) primeSound();
  if (action === "sound-toggle") {
    soundEnabled = !soundEnabled;
    if (soundEnabled) primeSound();
    void writePreference("qroom-sound", soundEnabled ? "on" : "off");
    render();
  }
  if (action === "home") { event.preventDefault(); notice = ""; view = "home"; render(); }
  if (action === "create") { notice = ""; view = "setup"; render(); }
  if (action === "join-view") { notice = ""; view = "join"; renderJoin(); }
  if (action === "start") { primeSound(); dispatch({ type: "START" }); }
  if (action === "next") dispatch({ type: "NEXT" });
  if (action === "correct") { if (soundEnabled) playSoundCue("correct"); dispatch({ type: "JUDGE", correct: true }); }
  if (action === "incorrect") { if (soundEnabled) playSoundCue("incorrect"); dispatch({ type: "JUDGE", correct: false }); }
  if (action === "undo") dispatch({ type: "UNDO" });
  if (action === "edit-score" && session?.role === "host") {
    const target = game.players.find((player) => player.id === id);
    const enteredScore = target && window.prompt(`${target.name}の変更後の得点を入力してください（0〜999）`, String(target.score));
    if (enteredScore !== null && target) {
      const score = Number(enteredScore.trim());
      if (!/^\d+$/.test(enteredScore.trim()) || !Number.isInteger(score) || score > 999) {
        notice = "得点は0〜999の整数で入力してください";
        render();
      } else dispatch({ type: "SET_SCORE", playerId: id, score });
    }
  }
  if (action === "edit-delay" && session?.role === "host") {
    const target = game.players.find((player) => player.id === id);
    const enteredDelay = target && window.prompt(`${target.name}の早押しDelayを秒で指定してください（0〜10）`, String(target.delaySeconds || 0));
    if (enteredDelay !== null && target) {
      const delaySeconds = Number(enteredDelay.trim());
      if (!/^\d+$/.test(enteredDelay.trim()) || !Number.isInteger(delaySeconds) || delaySeconds > 10) {
        notice = "早押しDelayは0〜10秒の整数で指定してください";
        render();
      } else dispatch({ type: "SET_DELAY", playerId: id, delaySeconds });
    }
  }
  if (action === "no-answer") dispatch({ type: "NO_ANSWER" });
  // Pointer users are handled on pointerdown; this fallback supports assistive click activation.
  if (action === "buzz" && event.detail === 0) { buzzFeedback(); if (soundEnabled) playSoundCue("buzz"); dispatch({ type: "BUZZ", playerId: id }); }
  if (action === "end") dispatch({ type: "END" });
  if (action === "reset") dispatch({ type: "RESET" });
  if (action === "fullscreen") requestFullscreen();
  if (action === "copy-code") {
    void shareRoomCode(game.roomId).then((message) => { notice = message; render(); }).catch(() => { notice = `ルームコード: ${game.roomId}`; render(); });
  }
  if (action === "leave-room") {
    event.preventDefault();
    if (event.target.closest("[data-action='leave-room']")?.tagName === "BUTTON" && !window.confirm("ルーム接続を終了しますか？")) return;
    if (event.target.closest("[data-action='leave-room']")?.tagName === "A" && session?.role === "host" && !window.confirm("ルーム画面を終了しますか？参加者との接続も閉じます。")) return;
    closeRoomView();
  }
});

app.addEventListener("pointerdown", (event) => {
  const button = event.target.closest(".player-buzz:not(:disabled)");
  if (!button) return;
  button.classList.add("pressed");
  buzzFeedback();
  if (soundEnabled) playSoundCue("buzz");
  dispatch({ type: "BUZZ", playerId: button.dataset.id });
});
app.addEventListener("pointerup", () => document.querySelectorAll(".player-buzz.pressed").forEach((button) => button.classList.remove("pressed")));
document.addEventListener("visibilitychange", () => {
  if (session && document.visibilityState === "visible" && game?.phase !== Phase.FINISHED) void setScreenAwake(true);
});
window.addEventListener("keydown", (event) => {
  if (event.repeat || event.target.matches("input,textarea,select,[contenteditable='true']") || event.altKey || event.ctrlKey || event.metaKey) return;
  if (view === "player" && event.code === "Space" && session?.playerId && canBuzz(game, session.playerId, Date.now(), currentQuestionStartAt())) {
    event.preventDefault();
    buzzFeedback();
    if (soundEnabled) playSoundCue("buzz");
    void dispatch({ type: "BUZZ", playerId: session.playerId });
    return;
  }
  if (view !== "room" || session?.role !== "host") return;
  const shortcuts = {
    Digit1: game.phase === Phase.BUZZED ? { type: "JUDGE", correct: true } : null,
    Numpad1: game.phase === Phase.BUZZED ? { type: "JUDGE", correct: true } : null,
    Digit2: game.phase === Phase.BUZZED ? { type: "JUDGE", correct: false } : null,
    Numpad2: game.phase === Phase.BUZZED ? { type: "JUDGE", correct: false } : null,
    KeyN: game.phase === Phase.READY && game.question > 0 ? { type: "NEXT" } : null,
    KeyU: canUndo ? { type: "UNDO" } : null,
  };
  const action = shortcuts[event.code];
  if (action) {
    event.preventDefault();
    if (soundEnabled) {
      primeSound();
      if (action.type === "JUDGE") playSoundCue(action.correct ? "correct" : "incorrect");
    }
    void dispatch(action);
  }
});

async function refreshRoom() {
  if (!session) return;
  try {
    const snapshot = await api(`/api/rooms/${session.roomId}`);
    notice = "";
    applySnapshot(snapshot);
  } catch {
    notice = "再接続中… · ネットワークを確認してください";
    render();
  }
}

window.addEventListener("offline", () => {
  if (!session) return;
  connectionState = "offline";
  notice = "オフラインです。接続が戻ると自動で再接続します。";
  render();
});
window.addEventListener("online", () => {
  if (!session) return;
  connectionState = "reconnecting";
  notice = "接続を復旧しています…";
  render();
  if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  eventSource?.close();
  eventSource = null;
  void refreshRoom().finally(() => { if (session) connectRoomEvents(); });
});

function closeRoomView() {
  eventSource?.close(); eventSource = null;
  if (reconnectTimer !== null) { window.clearTimeout(reconnectTimer); reconnectTimer = null; }
  session = null; game = null;
  connectionState = "disconnected";
  void setScreenAwake(false);
  void removePreference("qroom-session");
  view = "home";
  render();
}

void onAppResume(() => { void refreshRoom(); });
function openSharedRoom(url) {
  const code = roomCodeFromUrl(url);
  if (!code) return;
  pendingRoomCode = code;
  notice = "";
  view = "join";
  renderJoin();
}
void onAppUrlOpen(openSharedRoom);
void getLaunchUrl()?.then((url) => { if (url) openSharedRoom(url); }).catch(() => {});
void onNativeBackButton(async () => {
  if (view === "setup" || view === "join") {
    view = "home";
    render();
  } else if (view === "room" || view === "player") {
    if (window.confirm("ルーム接続を終了しますか？")) closeRoomView();
  } else {
    await exitNativeApp();
  }
});

async function restoreSession() {
  soundEnabled = (await readPreference("qroom-sound", "on")) !== "off";
  playerName = await readPreference("qroom-player", "プレイヤー");
  let savedSession = null;
  try { savedSession = JSON.parse(await readPreference("qroom-session", "null")); } catch { /* Ignore malformed local session data. */ }
  if (savedSession?.roomId && savedSession?.token && !validRoomCode.test(pendingRoomCode)) {
    try {
      const snapshot = await api(`/api/rooms/${savedSession.roomId}`);
      await connectRoom(snapshot, savedSession, savedSession.role === "player" ? "player" : "room");
      return;
    } catch (error) {
      if (error.message === "ルームが見つかりません") {
        await removePreference("qroom-session");
        notice = "保存されたルームは終了しています。新しいルームを作成するか、参加コードを入力してください。";
      } else {
        notice = "保存したルームに接続できません。ネットワークを確認して、もう一度読み込んでください。";
      }
    }
  }
  if (validRoomCode.test(pendingRoomCode)) {
    view = "join";
    renderJoin();
    return;
  }
  render();
}
render();
void restoreSession();
