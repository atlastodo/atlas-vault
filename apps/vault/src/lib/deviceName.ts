import { Platform } from "react-native";
import Constants from "expo-constants";

/** A user-agent string as a friendly "Browser on OS" label. */
export function formatUserAgent(ua?: string): string {
  if (!ua) return "Web browser";
  let os = "Web";
  if (/Windows/i.test(ua)) os = "Windows";
  else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Macintosh|Mac OS X/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\/|CriOS\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\/|FxiOS\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  return `${browser} on ${os}`;
}

/**
 * The name this sign-in shows under in the account's Devices & sessions list (in Atlas Todo's
 * settings): the app and the device, e.g. "Atlas Vault · Chrome on Linux".
 */
export function detectDeviceName(): string {
  let device: string;
  if (Platform.OS === "web") {
    device = formatUserAgent(typeof navigator !== "undefined" ? navigator.userAgent : undefined);
  } else {
    device = Constants.deviceName || (Platform.OS === "android" ? "Android device" : "iOS device");
  }
  return `Atlas Vault · ${device}`;
}
