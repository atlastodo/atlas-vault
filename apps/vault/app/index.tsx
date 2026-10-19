import { useRouter } from "expo-router";
import { useLock } from "../src/auth/AutoLockGate";
import { ItemsScreen } from "../src/screens/ItemsScreen";

export default function Items() {
  const router = useRouter();
  const { lockNow } = useLock();
  return (
    <ItemsScreen
      onOpen={(id) => router.push({ pathname: "/item/[id]", params: { id } })}
      onNew={() => router.push({ pathname: "/edit/[id]", params: { id: "new" } })}
      onSettings={() => router.push("/settings")}
      onGenerator={() => router.push("/generator")}
      onLock={() => void lockNow()}
    />
  );
}
