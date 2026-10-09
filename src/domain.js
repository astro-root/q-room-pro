export const Phase = Object.freeze({ LOBBY: "lobby", READY: "ready", QUESTION: "question", BUZZED: "buzzed", FINISHED: "finished" });

export const RULES = {
  sevenThree: { id: "sevenThree", name: "7○3×", winBy: 7, missLimit: 3, score: 1 },
  tenByTen: { id: "tenByTen", name: "10by10", winBy: 10, missLimit: null, score: 1 },
};

export function ruleForGame(game) {
  if (game.ruleId === "custom") return { id: "custom", name: `${game.winBy}○${game.missLimit}×`, winBy: game.winBy, missLimit: game.missLimit, score: 1 };
  return RULES[game.ruleId] ?? RULES.sevenThree;
}

export function createGame({ roomName, ruleId, winBy, missLimit, names }) {
  const rule = ruleId === "custom" && Number.isInteger(winBy) && winBy >= 1 && winBy <= 50 && Number.isInteger(missLimit) && missLimit >= 1 && missLimit <= 20
    ? { id: "custom", name: `${winBy}○${missLimit}×`, winBy, missLimit, score: 1 }
    : RULES[ruleId] ?? RULES.sevenThree;
  const players = names.map((name, index) => ({ id: `p${index + 1}`, name: name.trim(), correct: 0, incorrect: 0, score: 0, delaySeconds: 0, penalty: false, eliminated: false }));
  return { roomName: roomName.trim() || "練習ルーム", roomId: Math.random().toString(36).slice(2, 8).toUpperCase(), ruleId: rule.id, ...(rule.id === "custom" ? { winBy: rule.winBy, missLimit: rule.missLimit } : {}), phase: Phase.READY, question: 0, players, buzzedPlayerId: null, buzzOrder: [], message: "ゲーム開始を待っています" };
}

export function activePlayers(game) { return game.players.filter((player) => !player.eliminated); }

export function buzzDelayRemaining(game, playerId, questionStartAt, now = Date.now()) {
  const player = game.players.find((item) => item.id === playerId);
  if (!player || !questionStartAt || !player.delaySeconds) return 0;
  return Math.max(0, questionStartAt + player.delaySeconds * 1000 - now);
}

export function canBuzz(game, playerId, now = Date.now(), questionStartAt = 0) {
  return game.phase === Phase.QUESTION && !game.buzzOrder.includes(playerId) && activePlayers(game).some((player) => player.id === playerId && !player.penalty) && buzzDelayRemaining(game, playerId, questionStartAt, now) === 0;
}

export function reduceGame(game, action) {
  if (action.type === "START") {
    if (game.phase !== Phase.READY || !game.players.length) return game;
    return { ...game, phase: Phase.QUESTION, question: 1, buzzOrder: [], buzzedPlayerId: null, message: "問題を出題中" };
  }
  if (action.type === "BUZZ") {
    if (!canBuzz(game, action.playerId, action.now ?? Date.now(), action.questionStartAt ?? 0)) return game;
    const buzzOrder = [...game.buzzOrder, action.playerId];
    return { ...game, phase: Phase.BUZZED, buzzedPlayerId: action.playerId, buzzOrder, message: `${game.players.find((player) => player.id === action.playerId)?.name} が押しました` };
  }
  if (action.type === "NO_ANSWER") {
    if (game.phase !== Phase.QUESTION) return game;
    return { ...game, phase: Phase.READY, buzzedPlayerId: null, buzzOrder: [], message: "時間切れ · 回答なし" };
  }
  if (action.type === "JUDGE") {
    if (game.phase !== Phase.BUZZED) return game;
    const rule = ruleForGame(game);
    const players = game.players.map((player) => {
      if (player.id !== game.buzzedPlayerId) return player;
      const updated = action.correct
        ? { ...player, correct: player.correct + 1, score: player.score + rule.score }
        : { ...player, incorrect: player.incorrect + 1 };
      const eliminated = rule.missLimit !== null && updated.incorrect >= rule.missLimit;
      return { ...updated, eliminated, penalty: !action.correct && !eliminated };
    });
    const winner = players.find((player) => player.correct >= rule.winBy);
    const noPlayers = players.every((player) => player.eliminated);
    const canContinueQuestion = players.some((player) => !player.eliminated && !player.penalty && !game.buzzOrder.includes(player.id));
    const phase = winner || noPlayers ? Phase.FINISHED : action.correct || !canContinueQuestion ? Phase.READY : Phase.QUESTION;
    const message = winner ? `${winner.name} が勝利しました` : noPlayers ? "全員が失格しました" : action.correct ? "正解！次の問題へ" : canContinueQuestion ? "不正解 · ほかのプレイヤーの回答を受付中" : "不正解 · 回答できるプレイヤーがいません";
    return { ...game, players, phase, buzzedPlayerId: null, message };
  }
  if (action.type === "SET_SCORE") {
    const target = game.players.find((player) => player.id === action.playerId);
    if (!target || !Number.isInteger(action.score) || action.score < 0 || action.score > 999) return game;
    return {
      ...game,
      players: game.players.map((player) => player.id === action.playerId ? { ...player, score: action.score } : player),
      message: `${target.name}の得点を${action.score}点に修正しました`,
    };
  }
  if (action.type === "SET_DELAY") {
    const target = game.players.find((player) => player.id === action.playerId);
    if (game.phase !== Phase.READY || game.question !== 0 || !target || !Number.isInteger(action.delaySeconds) || action.delaySeconds < 0 || action.delaySeconds > 10) return game;
    return {
      ...game,
      players: game.players.map((player) => player.id === action.playerId ? { ...player, delaySeconds: action.delaySeconds } : player),
      message: `${target.name}の早押しDelayを${action.delaySeconds}秒に設定しました`,
    };
  }
  if (action.type === "NEXT") {
    if (game.phase !== Phase.READY) return game;
    return { ...game, question: game.question + 1, phase: Phase.QUESTION, buzzOrder: [], buzzedPlayerId: null, players: game.players.map((player) => ({ ...player, penalty: false })), message: "問題を出題中" };
  }
  if (action.type === "END") return { ...game, phase: Phase.FINISHED, message: "ゲーム終了" };
  if (action.type === "RESET") return { ...game, phase: Phase.READY, question: 0, buzzOrder: [], buzzedPlayerId: null, players: game.players.map((player) => ({ ...player, correct: 0, incorrect: 0, score: 0, penalty: false, eliminated: false })), message: "ゲームをリセットしました" };
  return game;
}

export function orderedResults(game) {
  const rule = ruleForGame(game);
  return [...game.players].sort((a, b) => Number(b.correct >= rule.winBy) - Number(a.correct >= rule.winBy) || b.score - a.score || b.correct - a.correct || a.incorrect - b.incorrect);
}
