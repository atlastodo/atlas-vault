import { useLocalSearchParams, useRouter } from "expo-router";
import { ItemScreen } from "../../src/screens/ItemScreen";

export default function Item() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const back = () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <ItemScreen
      id={id ?? ""}
      onBack={back}
      onEdit={() => router.push({ pathname: "/edit/[id]", params: { id: id ?? "" } })}
      onHistory={() => router.push({ pathname: "/history/[id]", params: { id: id ?? "" } })}
    />
  );
}
