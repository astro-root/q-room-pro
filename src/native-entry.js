import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";

globalThis.QROOM_PLATFORM = {
  ...(globalThis.QROOM_PLATFORM || {}),
  isNative: Capacitor.isNativePlatform(),
  haptics: { buzz: () => Haptics.impact({ style: ImpactStyle.Light }) },
  share: ({ title, text }) => Share.share({ title, text, dialogTitle: "共有" }),
  onBackButton: (handler) => App.addListener("backButton", handler),
  onAppResume: (handler) => App.addListener("appStateChange", ({ isActive }) => { if (isActive) handler(); }),
  exitApp: () => App.exitApp(),
};

await import("./main.js");
