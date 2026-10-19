import { useRouter } from "expo-router";
import { SettingsScreen } from "../src/screens/SettingsScreen";

export default function Settings() {
  const router = useRouter();
  return (
    <SettingsScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      onTrash={() => router.push("/trash")}
      onFolders={() => router.push("/folders")}
    />
  );
}
