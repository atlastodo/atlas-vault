import { useRouter } from "expo-router";
import { GeneratorScreen } from "../src/screens/GeneratorScreen";

export default function Generator() {
  const router = useRouter();
  return (
    <GeneratorScreen onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
  );
}
