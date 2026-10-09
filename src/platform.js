// Keep browser and Capacitor-specific APIs behind this module. The game UI and
// domain can then be shared by the web app and a native WebView shell.
const capacitor = globalThis.Capacitor;
const nativeBridge = globalThis.QROOM_PLATFORM || {};
let screenWakeLock = null;
let audioContext = null;
export const isNativePlatform = Boolean(nativeBridge.isNative || capacitor?.isNativePlatform?.());

export const apiBase = (nativeBridge.apiBase || globalThis.QROOM_API_BASE || "").replace(/\/$/, "");
const webBase = (nativeBridge.webBase || globalThis.QROOM_WEB_BASE || "").replace(/\/$/, "");

export function request(path, options) {
  const url = `${apiBase}${path}`;
  return nativeBridge.request ? nativeBridge.request(url, options) : fetch(url, options);
}

export async function readPreference(key, fallback = "") {
  if (nativeBridge.isNative && key === "qroom-session" && !nativeBridge.storage?.get) return fallback;
  if (nativeBridge.storage?.get) {
    try { return (await nativeBridge.storage.get(key)) ?? fallback; } catch { return fallback; }
  }
  const preferences = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Preferences;
  if (preferences?.get) {
    try { return (await preferences.get({ key })).value ?? fallback; } catch { return fallback; }
  }
  try { return globalThis.localStorage?.getItem(key) ?? fallback; } catch { return fallback; }
}

export async function writePreference(key, value) {
  if (nativeBridge.isNative && key === "qroom-session" && !nativeBridge.storage?.set) return;
  if (nativeBridge.storage?.set) {
    try { await nativeBridge.storage.set(key, value); } catch { /* Storage is best effort; the session can be re-entered. */ }
    return;
  }
  const preferences = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Preferences;
  if (preferences?.set) {
    try { await preferences.set({ key, value }); } catch { /* Storage is best effort; the session can be re-entered. */ }
    return;
  }
  try { globalThis.localStorage?.setItem(key, value); } catch { /* Storage may be unavailable in private contexts. */ }
}

export async function removePreference(key) {
  if (nativeBridge.isNative && key === "qroom-session" && !nativeBridge.storage?.remove) return;
  if (nativeBridge.storage?.remove) {
    try { await nativeBridge.storage.remove(key); } catch { /* A stale session will be rejected by the server. */ }
    return;
  }
  const preferences = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Preferences;
  if (preferences?.remove) {
    try { await preferences.remove({ key }); } catch { /* A stale session will be rejected by the server. */ }
    return;
  }
  try { globalThis.localStorage?.removeItem(key); } catch { /* Storage may be unavailable in private contexts. */ }
}

export function buzzFeedback(duration = 18) {
  if (nativeBridge.haptics?.buzz) {
    try { void nativeBridge.haptics.buzz(duration)?.catch?.(() => {}); } catch { /* Haptic feedback is optional. */ }
    return;
  }
  const haptics = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Haptics;
  if (haptics?.impact) {
    void haptics.impact({ style: "light" }).catch(() => {});
  } else if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

export function primeSound() {
  const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext ||= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume().catch(() => {});
  } catch { /* Audio is an optional enhancement. */ }
}

export function playSoundCue(kind = "buzz") {
  primeSound();
  if (!audioContext || audioContext.state !== "running") return;
  const frequencies = kind === "buzz" ? [740, 520] : kind === "correct" ? [660, 880] : [260, 190];
  const start = audioContext.currentTime;
  frequencies.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const offset = index * 0.065;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + offset);
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.045, start + offset + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.09);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.1);
  });
}

export async function shareRoomCode(code) {
  const appUrl = new URL("qroom://join");
  appUrl.searchParams.set("room", code);
  const text = `Q-Room Pro ルームコード: ${code}${nativeBridge.isNative ? `\nアプリで開く: ${appUrl.href}` : ""}`;
  const joinUrl = new URL("/", webBase || (isNativePlatform ? apiBase : globalThis.location.origin));
  joinUrl.searchParams.set("room", code);
  if (nativeBridge.share) {
    await nativeBridge.share({ title: "Q-Room Pro", text, url: joinUrl.href });
    return "共有しました";
  }
  const nativeShare = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Share;
  if (nativeShare?.share) {
    await nativeShare.share({ title: "Q-Room Pro", text, url: joinUrl.href, dialogTitle: "ルームに参加" });
    return "共有しました";
  }
  if (typeof navigator !== "undefined" && navigator.share) {
    await navigator.share({ title: "Q-Room Pro", text, url: joinUrl.href });
    return "共有しました";
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(joinUrl.href);
    return "参加リンクをコピーしました";
  }
  return `参加リンク: ${joinUrl.href}`;
}

export function requestFullscreen(element = document.documentElement) {
  if (nativeBridge.fullscreen) return nativeBridge.fullscreen();
  return element.requestFullscreen?.();
}

export async function setScreenAwake(awake) {
  if (nativeBridge.setScreenAwake) {
    try { await nativeBridge.setScreenAwake(awake); } catch { /* Keeping the display awake is a best-effort convenience. */ }
    return;
  }
  if (!awake) {
    const lock = screenWakeLock;
    screenWakeLock = null;
    try { await lock?.release(); } catch { /* The browser may already have released it. */ }
    return;
  }
  if (screenWakeLock || globalThis.document?.visibilityState === "hidden" || !globalThis.navigator?.wakeLock?.request) return;
  try {
    screenWakeLock = await navigator.wakeLock.request("screen");
    screenWakeLock.addEventListener("release", () => { screenWakeLock = null; }, { once: true });
  } catch { /* Unsupported browsers and denied requests continue normally. */ }
}

export function canRequestFullscreen() {
  return Boolean(nativeBridge.fullscreen || (!isNativePlatform && globalThis.document?.documentElement?.requestFullscreen));
}

export function openRoomEvents(roomId) {
  const url = `${apiBase}/api/rooms/${encodeURIComponent(roomId)}/events`;
  return nativeBridge.openRoomEvents ? nativeBridge.openRoomEvents(url) : new EventSource(url);
}

export function onNativeBackButton(handler) {
  return nativeBridge.onBackButton?.(handler);
}

export function onAppResume(handler) {
  return nativeBridge.onAppResume?.(handler);
}

export function exitNativeApp() {
  return nativeBridge.exitApp?.();
}

export function onAppUrlOpen(handler) {
  return nativeBridge.onAppUrlOpen?.(handler);
}

export function getLaunchUrl() {
  return nativeBridge.getLaunchUrl?.();
}
