import { Button, Header, Screen } from "../ui/components";
import { GeneratorPanel } from "../ui/Generator";

/** The generator on its own: make a password or passphrase and copy it. */
export function GeneratorScreen({ onBack }: { onBack: () => void }) {
  return (
    <Screen scroll>
      <Header title="Generator" right={<Button label="Back" kind="ghost" onPress={onBack} />} />
      <GeneratorPanel />
    </Screen>
  );
}
