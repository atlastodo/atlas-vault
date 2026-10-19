// Dynamic Expo config: app.json holds the defaults (the upstream identifiers, and the version that
// scripts/bump-version.sh maintains); this lets a fork or CI override the identifiers from the
// environment without editing it.
//
//   ATLAS_APP_ID          Android package and iOS bundle identifier.
//   ATLAS_EAS_PROJECT_ID  An EAS project id, which also turns on EAS updates from it. Unset (the
//                         default): no EAS project and no update server.
//
// Empty counts as unset (CI passes an unset repository variable as an empty string).
import type { ConfigContext, ExpoConfig } from "expo/config";

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const expo = config as ExpoConfig;
  const appId = envValue("ATLAS_APP_ID");
  const projectId = envValue("ATLAS_EAS_PROJECT_ID");
  return {
    ...expo,
    ios: appId ? { ...expo.ios, bundleIdentifier: appId } : expo.ios,
    android: appId ? { ...expo.android, package: appId } : expo.android,
    extra: projectId ? { ...expo.extra, eas: { projectId } } : expo.extra,
    updates: projectId
      ? { ...expo.updates, enabled: true, url: `https://u.expo.dev/${projectId}` }
      : expo.updates,
  };
};
