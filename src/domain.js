export const Phase = Object.freeze({ LOBBY: "lobby", READY: "ready", QUESTION: "question", BUZZED: "buzzed", FINISHED: "finished" });

export const RULES = {
  sevenThree: { id: "sevenThree", name: "7○3×", winBy: 7, missLimit: 3, score: 1 },
  tenByTen: { id: "tenByTen", name: "10by10", winBy: 10, missLimit: null, score: 1 },
};

export function createGame({ roomName, ruleId, names }) {
  const rule = RULES[ruleId] ?? RULES.sevenThree;
  const players = names.map((name, index) => ({ id: `p${index + 1}`, name: name.trim(), correct: 0, incorrect: 0, score: 0, penalty: false, eliminated: false }));
  return { roomName: roomName.trim() || "練習ルーム", roomId: Math.random().toString(36).slice(2, 8).toUpperCase(), ruleId: rule.id, phase: Phase.READY, question: 0, players, buzzedPlayerId: null, buzzOrder: [], message: "ゲーム開始を待っています" };
}

export function activePlayers(game) { return game.players.filter((player) => !player.eliminated); }

export function canBuzz(game, playerId) {
  return game.phase === Phase.QUESTION && !game.buzzOrder.includes(playerId) && activePlayers(game).some((player) => player.id === playerId && !player.penalty);
}

export function reduceGame(game, action) {
  if (action.type === "START") {
    if (game.phase !== Phase.READY || !game.players.length) return game;
    return { ...game, phase: Phase.QUESTION, question: 1, buzzOrder: [], buzzedPlayerId: null, message: "問題を出題中" };
  }
  if (action.type === "BUZZ") {
    if (!canBuzz(game, action.playerId)) return game;
    const buzzOrder = [...game.buzzOrder, action.playerId];
    return { ...game, phase: Phase.BUZZED, buzzedPlayerId: action.playerId, buzzOrder, message: `${game.players.find((player) => player.id === action.playerId)?.name} が押しました` };
  }
  if (action.type === "NO_ANSWER") {
    if (game.phase !== Phase.QUESTION) return game;
    return { ...game, phase: Phase.READY, buzzedPlayerId: null, buzzOrder: [], message: "時間切れ · 回答なし" };
  }
  if (action.type === "JUDGE") {
    if (game.phase !== Phase.BUZZED) return game;
    const players = game.players.map((player) => {
      if (player.id !== game.buzzedPlayerId) return player;
      const updated = action.correct
        ? { ...player, correct: player.correct + 1, score: player.score + RULES[game.ruleId].score }
        : { ...player, incorrect: player.incorrect + 1 };
      const eliminated = RULES[game.ruleId].missLimit !== null && updated.incorrect >= RULES[game.ruleId].missLimit;
      return { ...updated, eliminated, penalty: !action.correct && !eliminated };
    });
    const winner = players.find((player) => player.correct >= RULES[game.ruleId].winBy);
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
  if (action.type === "NEXT") {
    if (game.phase !== Phase.READY) return game;
    return { ...game, question: game.question + 1, phase: Phase.QUESTION, buzzOrder: [], buzzedPlayerId: null, players: game.players.map((player) => ({ ...player, penalty: false })), message: "問題を出題中" };
  }
  if (action.type === "END") return { ...game, phase: Phase.FINISHED, message: "ゲーム終了" };
  if (action.type === "RESET") return { ...game, phase: Phase.READY, question: 0, buzzOrder: [], buzzedPlayerId: null, players: game.players.map((player) => ({ ...player, correct: 0, incorrect: 0, score: 0, penalty: false, eliminated: false })), message: "ゲームをリセットしました" };
  return game;
}

export function orderedResults(game) {
  return [...game.players].sort((a, b) => Number(b.correct >= RULES[game.ruleId].winBy) - Number(a.correct >= RULES[game.ruleId].winBy) || b.score - a.score || b.correct - a.correct || a.incorrect - b.incorrect);
}
