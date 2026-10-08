import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";
import { KeychainAccess, SecureStorage } from "@aparajita/capacitor-secure-storage";

await SecureStorage.setKeyPrefix("qroom-pro");
await SecureStorage.setSynchronize(false);
await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);

globalThis.QROOM_PLATFORM = {
  ...(globalThis.QROOM_PLATFORM || {}),
  isNative: Capacitor.isNativePlatform(),
  haptics: { buzz: () => Haptics.impact({ style: ImpactStyle.Light }) },
  share: ({ title, text }) => Share.share({ title, text, dialogTitle: "共有" }),
  storage: {
    get: (key) => SecureStorage.getItem(key),
    set: (key, value) => SecureStorage.setItem(key, value),
    remove: (key) => SecureStorage.removeItem(key),
  },
  onBackButton: (handler) => App.addListener("backButton", handler),
  onAppResume: (handler) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) handler(); }),
  exitApp: () => App.exitApp(),
};

await import("./main.js");
