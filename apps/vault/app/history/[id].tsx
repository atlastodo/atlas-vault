import { useLocalSearchParams, useRouter } from "expo-router";
import { HistoryScreen } from "../../src/screens/HistoryScreen";

export default function History() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <HistoryScreen
      id={id ?? ""}
      onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))}
    />
  );
}
