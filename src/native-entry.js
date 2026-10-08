import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Share } from "@capacitor/share";

globalThis.QROOM_PLATFORM = {
  ...(globalThis.QROOM_PLATFORM || {}),
  isNative: Capacitor.isNativePlatform(),
  haptics: { buzz: () => Haptics.impact({ style: ImpactStyle.Light }) },
  share: ({ title, text }) => Share.share({ title, text, dialogTitle: "共有" }),
};

await import("./main.js");
