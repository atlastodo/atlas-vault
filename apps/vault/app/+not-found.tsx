import { useRouter } from "expo-router";
import { Button, Header, Muted, Screen } from "../src/ui/components";

export default function NotFound() {
  const router = useRouter();
  return (
    <Screen>
      <Header title="Nothing here" />
      <Muted>This page does not exist.</Muted>
      <Button label="Go to the vault" onPress={() => router.replace("/")} />
    </Screen>
  );
}
