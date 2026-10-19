import { useRouter } from "expo-router";
import { TrashScreen } from "../src/screens/TrashScreen";

export default function Trash() {
  const router = useRouter();
  return <TrashScreen onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
