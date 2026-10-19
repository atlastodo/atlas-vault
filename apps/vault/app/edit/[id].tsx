import { useLocalSearchParams, useRouter } from "expo-router";
import { ItemEditorScreen } from "../../src/screens/ItemEditorScreen";

export default function Edit() {
  const router = useRouter();
  const { id, type } = useLocalSearchParams<{ id: string; type?: string }>();
  const isNew = id === "new";
  const done = (saved: string | null) => {
    if (isNew && saved) router.replace({ pathname: "/item/[id]", params: { id: saved } });
    else if (router.canGoBack()) router.back();
    else router.replace("/");
  };
  // Keyed by id: opening another item starts a fresh form.
  return (
    <ItemEditorScreen key={id} id={isNew ? null : (id ?? null)} initialType={type} onDone={done} />
  );
}
