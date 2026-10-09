import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Phase, RULES, createGame, reduceGame } from "./src/domain.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 8000);
const apiOrigin = (process.env.QROOM_API_ORIGIN || "").replace(/\/$/, "");
const allowedOrigins = new Set([
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  ...(process.env.QROOM_WEB_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean),
]);
const rooms = new Map();
const requestWindows = new Map();
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml" };
const staticFiles = new Set(["index.html", "manifest.webmanifest", "service-worker.js", "icon.svg", "runtime-config.js"]);
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function allowRequest(request, bucket, limit) {
  const now = Date.now();
  const key = `${request.socket.remoteAddress || "unknown"}:${bucket}`;
  const current = requestWindows.get(key);
  if (!current || now - current.start >= 60_000) {
    requestWindows.set(key, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= limit;
}

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  response.end(JSON.stringify(value));
}

function applyCors(request, response) {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.has(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
}

async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error("リクエストが大きすぎます");
  }
  return body ? JSON.parse(body) : {};
}

function makeCode() {
  return Array.from({ length: 8 }, () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)]).join("");
}

function publicRoom(room) {
  return { game: room.game, version: room.version, questionDeadline: room.questionDeadline, canUndo: room.undoHistory.length > 0, undoCount: room.undoHistory.length };
}

function broadcast(room) {
  room.updatedAt = Date.now();
  const payload = `data: ${JSON.stringify(publicRoom(room))}\n\n`;
  for (const response of room.listeners) response.write(payload);
}

function setQuestionTimer(room, deadline = Date.now() + 20_000) {
  clearTimeout(room.questionTimer);
  room.questionDeadline = deadline;
  room.questionTimer = setTimeout(() => {
    room.questionTimer = null;
    const next = reduceGame(room.game, { type: "NO_ANSWER" });
    if (next !== room.game) {
      room.game = next;
      room.questionDeadline = null;
      room.version += 1;
      broadcast(room);
    }
  }, Math.max(0, deadline - Date.now()));
}

function stopQuestionTimer(room) {
  clearTimeout(room.questionTimer);
  room.questionTimer = null;
  room.questionDeadline = null;
}

function applyAction(room, action) {
  const previous = room.game;
  const next = reduceGame(previous, action);
  if (next === previous) return false;
  room.game = next;
  if (action.type === "NO_ANSWER") room.undoHistory = [];
  if (next.phase === Phase.QUESTION && previous.phase !== Phase.QUESTION) setQuestionTimer(room);
  else if (next.phase !== Phase.QUESTION) stopQuestionTimer(room);
  room.version += 1;
  broadcast(room);
  return true;
}

function hostAuthorized(room, request) {
  return request.headers.authorization === `Bearer ${room.hostToken}`;
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  if (!staticFiles.has(relative) && !relative.startsWith("src/")) return json(response, 404, { error: "見つかりません" });
  const file = resolve(root, relative);
  const allowedRoot = relative.startsWith("src/") ? resolve(root, "src") : root;
  if (file !== allowedRoot && !file.startsWith(allowedRoot + sep)) return json(response, 404, { error: "見つかりません" });
  try {
    const contents = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer", "Content-Security-Policy": `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' capacitor: http://localhost https://localhost ${apiOrigin}; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` });
    response.end(contents);
  } catch {
    json(response, 404, { error: "見つかりません" });
  }
}

const server = createServer(async (request, response) => {
  applyCors(request, response);
  const url = new URL(request.url, "http://localhost");
  const path = url.pathname;
  try {
    if (request.method === "OPTIONS" && path.startsWith("/api/")) {
      response.writeHead(204, { "Access-Control-Max-Age": "600" });
      return response.end();
    }
    if (request.method === "GET" && path === "/api/health") {
      return json(response, 200, { status: "ok" });
    }
    if (request.method === "POST" && path === "/api/rooms") {
      if (!allowRequest(request, "create", 10)) return json(response, 429, { error: "しばらく待ってからもう一度お試しください" });
      if (rooms.size >= 1000) return json(response, 503, { error: "現在ルームを作成できません。しばらく待ってください" });
      const body = await readBody(request);
      const roomName = typeof body.roomName === "string" ? body.roomName.trim().slice(0, 40) : "";
      const ruleId = body.ruleId ?? "sevenThree";
      if (!roomName) return json(response, 400, { error: "ルーム名を入力してください" });
      if (ruleId === "custom" && (!Number.isInteger(body.winBy) || body.winBy < 1 || body.winBy > 50 || !Number.isInteger(body.missLimit) || body.missLimit < 1 || body.missLimit > 20)) {
        return json(response, 400, { error: "カスタムルールは正解数1〜50、失格となる誤答数1〜20で指定してください" });
      }
      if (ruleId !== "custom" && !Object.hasOwn(RULES, ruleId)) return json(response, 400, { error: "ゲームルールが不正です" });
      let roomId;
      do { roomId = makeCode(); } while (rooms.has(roomId));
      const game = createGame({ roomName, ruleId, winBy: body.winBy, missLimit: body.missLimit, names: [] });
      game.roomId = roomId;
      const room = { game, hostToken: randomBytes(32).toString("base64url"), version: 1, questionDeadline: null, questionTimer: null, undoHistory: [], listeners: new Set(), players: new Map(), updatedAt: Date.now() };
      rooms.set(roomId, room);
      return json(response, 201, { ...publicRoom(room), hostToken: room.hostToken });
    }

    const eventMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/events$/);
    if (request.method === "GET" && eventMatch) {
      const room = rooms.get(eventMatch[1]);
      if (!room) return json(response, 404, { error: "ルームが見つかりません" });
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
      response.write(`data: ${JSON.stringify(publicRoom(room))}\n\n`);
      room.listeners.add(response);
      const heartbeat = setInterval(() => response.write(": keep-alive\n\n"), 20_000);
      response.on("close", () => { clearInterval(heartbeat); room.listeners.delete(response); });
      return;
    }

    const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
    if (request.method === "GET" && roomMatch) {
      const room = rooms.get(roomMatch[1]);
      return room ? json(response, 200, publicRoom(room)) : json(response, 404, { error: "ルームが見つかりません" });
    }

    const joinMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/join$/);
    if (request.method === "POST" && joinMatch) {
      if (!allowRequest(request, "join", 12)) return json(response, 429, { error: "参加試行が多すぎます。しばらく待ってください" });
      const room = rooms.get(joinMatch[1]);
      if (!room) return json(response, 404, { error: "ルームが見つかりません" });
      const body = await readBody(request);
      if (room.game.phase !== Phase.READY || room.game.question !== 0) return json(response, 409, { error: "このルームは参加受付を終了しました" });
      if (room.game.players.length >= 12) return json(response, 409, { error: "このルームの参加上限（12人）に達しました" });
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 24) : "";
      if (!name) return json(response, 400, { error: "プレイヤー名を入力してください" });
      const playerId = randomUUID();
      const playerToken = randomBytes(32).toString("base64url");
      const player = { id: playerId, name, correct: 0, incorrect: 0, score: 0, penalty: false, eliminated: false };
      room.game = { ...room.game, players: [...room.game.players, player] };
      room.players.set(playerToken, playerId);
      room.version += 1;
      broadcast(room);
      return json(response, 201, { ...publicRoom(room), playerId, playerToken });
    }

    const actionMatch = path.match(/^\/api\/rooms\/([A-Z0-9]+)\/actions$/);
    if (request.method === "POST" && actionMatch) {
      if (!allowRequest(request, "action", 180)) return json(response, 429, { error: "操作が多すぎます。しばらく待ってください" });
      const room = rooms.get(actionMatch[1]);
      if (!room) return json(response, 404, { error: "ルームが見つかりません" });
      const body = await readBody(request);
      const action = body.action;
      if (!action || typeof action.type !== "string") return json(response, 400, { error: "操作が不正です" });
      if (!Number.isInteger(body.version) || body.version !== room.version) return json(response, 409, { error: "ゲーム状態が更新されています。最新状態を同期します", ...publicRoom(room) });
      if (action.type === "BUZZ") {
        const playerId = room.players.get(body.playerToken);
        if (!playerId || playerId !== action.playerId) return json(response, 403, { error: "プレイヤー認証に失敗しました" });
      } else if (!hostAuthorized(room, request)) {
        return json(response, 403, { error: "司会者の認証が必要です" });
      }
      if (action.type === "UNDO") {
        if (!room.undoHistory.length) return json(response, 409, { error: "取り消せる操作がありません", ...publicRoom(room) });
        clearTimeout(room.questionTimer);
        room.questionTimer = null;
        const undoState = room.undoHistory.pop();
        room.game = undoState.game;
        room.questionDeadline = null;
        if (undoState.questionDeadline && room.game.phase === Phase.QUESTION) setQuestionTimer(room, undoState.questionDeadline);
        room.version += 1;
        broadcast(room);
        return json(response, 200, publicRoom(room));
      }
      if (action.type === "JUDGE" && typeof action.correct !== "boolean") return json(response, 400, { error: "正誤判定が不正です" });
      if (action.type === "SET_SCORE" && (!room.game.players.some((player) => player.id === action.playerId) || !Number.isInteger(action.score) || action.score < 0 || action.score > 999)) {
        return json(response, 400, { error: "得点は0〜999の整数で指定してください" });
      }
      if (action.type === "SET_DELAY" && (!room.game.players.some((player) => player.id === action.playerId) || !Number.isInteger(action.delaySeconds) || action.delaySeconds < 0 || action.delaySeconds > 10 || room.game.phase !== Phase.READY || room.game.question !== 0)) {
        return json(response, 400, { error: "早押しDelayはロビーで0〜10秒に設定してください" });
      }
      if (room.questionDeadline && room.questionDeadline <= Date.now()) applyAction(room, { type: "NO_ANSWER" });
      const priorGame = room.game;
      const priorHistory = room.undoHistory;
      room.undoHistory = action.type === "JUDGE" || action.type === "SET_SCORE" || action.type === "SET_DELAY"
        ? [...priorHistory, { game: priorGame, questionDeadline: room.questionDeadline }].slice(-20)
        : [];
      const actionToApply = action.type === "BUZZ"
        ? { ...action, now: Date.now(), questionStartAt: room.questionDeadline ? room.questionDeadline - 20_000 : 0 }
        : action;
      if (!applyAction(room, actionToApply)) {
        room.undoHistory = priorHistory;
        return json(response, 409, { error: "現在の状態では操作できません", ...publicRoom(room) });
      }
      return json(response, 200, publicRoom(room));
    }

    if (path.startsWith("/api/")) return json(response, 404, { error: "APIが見つかりません" });
    return await serveStatic(request, response, path);
  } catch (error) {
    return json(response, 400, { error: error instanceof SyntaxError ? "JSONを読み取れません" : error.message || "リクエストに失敗しました" });
  }
});

server.listen(port, "0.0.0.0", () => console.log(`Q-Room Pro listening on http://localhost:${port}`));

setInterval(() => {
  const expireBefore = Date.now() - 12 * 60 * 60 * 1000;
  for (const [roomId, room] of rooms) {
    if (room.updatedAt < expireBefore && room.listeners.size === 0) {
      stopQuestionTimer(room);
      rooms.delete(roomId);
    }
  }
  for (const [key, window] of requestWindows) if (Date.now() - window.start > 60_000) requestWindows.delete(key);
}, 60 * 60 * 1000).unref();
