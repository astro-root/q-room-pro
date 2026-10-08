// Keep browser and Capacitor-specific APIs behind this module. The game UI and
// domain can then be shared by the web app and a native WebView shell.
const capacitor = globalThis.Capacitor;

export const apiBase = (globalThis.QROOM_API_BASE || "").replace(/\/$/, "");

export function readPreference(key, fallback = "") {
  try { return globalThis.localStorage?.getItem(key) ?? fallback; } catch { return fallback; }
}

export function writePreference(key, value) {
  try { globalThis.localStorage?.setItem(key, value); } catch { /* Storage may be unavailable in private contexts. */ }
}

export function removePreference(key) {
  try { globalThis.localStorage?.removeItem(key); } catch { /* Storage may be unavailable in private contexts. */ }
}

export function buzzFeedback(duration = 18) {
  const haptics = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Haptics;
  if (haptics?.impact) {
    void haptics.impact({ style: "light" }).catch(() => {});
  } else if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(duration);
  }
}

export async function shareRoomCode(code) {
  const text = `Q-Room Pro ルームコード: ${code}`;
  const nativeShare = capacitor?.isNativePlatform?.() && capacitor?.Plugins?.Share;
  if (nativeShare?.share) {
    await nativeShare.share({ title: "Q-Room Pro", text, dialogTitle: "ルームコードを共有" });
    return "共有しました";
  }
  if (typeof navigator !== "undefined" && navigator.share) {
    await navigator.share({ title: "Q-Room Pro", text });
    return "共有しました";
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(code);
    return "ルームコードをコピーしました";
  }
  return `ルームコード: ${code}`;
}

export function requestFullscreen(element = document.documentElement) {
  return element.requestFullscreen?.();
}

export function openRoomEvents(roomId) {
  return new EventSource(`${apiBase}/api/rooms/${encodeURIComponent(roomId)}/events`);
}
