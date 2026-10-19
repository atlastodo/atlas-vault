import { useRouter } from "expo-router";
import { FoldersScreen } from "../src/screens/FoldersScreen";

export default function Folders() {
  const router = useRouter();
  return (
    <FoldersScreen onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
  );
}
