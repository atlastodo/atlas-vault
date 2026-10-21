import { fireEvent, render, screen } from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { clearCopiedSecret } from "../lib/clipboard";
import { memoryVault } from "../test/vault";
import { ItemScreen } from "./ItemScreen";

const board = (Clipboard as unknown as { __clipboard: { value: string } }).__clipboard;

async function setup() {
  const vault = memoryVault();
  const item = vault.items.create({
    name: "GitHub",
    fields: [
      { name: "username", value: "octo" },
      { name: "password", kind: "hidden", value: "hunter2" },
      // RFC 6238's SHA-1 seed.
      { name: "totp", kind: "totp", value: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" },
    ],
    urls: ["https://github.com"],
  });
  const onHistory = jest.fn();
  await render(
    <vault.Provider>
      <ItemScreen id={item.id} onBack={jest.fn()} onEdit={jest.fn()} onHistory={onHistory} />
    </vault.Provider>,
  );
  return { vault, item, onHistory };
}

describe("ItemScreen", () => {
  // A copied secret leaves its clear timer pending.
  afterEach(() => clearCopiedSecret());

  it("masks a secret until revealed", async () => {
    await setup();
    expect(screen.getByText("octo")).toBeTruthy();
    expect(screen.queryByText("hunter2")).toBeNull();
    expect(screen.getByLabelText("password, hidden")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Reveal password" }));
    expect(screen.getByText("hunter2")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Hide password" }));
    expect(screen.queryByText("hunter2")).toBeNull();
  });

  it("copies a secret", async () => {
    await setup();
    await fireEvent.press(screen.getByRole("button", { name: "Copy password" }));
    expect(board.value).toBe("hunter2");
  });

  it("shows a TOTP field as a code, never its seed", async () => {
    await setup();
    expect(screen.queryByText(/GEZDGNBV/)).toBeNull();
    expect(screen.getByText("totp (one-time code)")).toBeTruthy();
    expect(screen.getByText(/^\d{3} \d{3}$/)).toBeTruthy();
  });

  it("toggles the favorite and opens the history", async () => {
    const { vault, item, onHistory } = await setup();
    await fireEvent.press(screen.getByRole("button", { name: "Add to favorites" }));
    expect(vault.items.get(item.id)?.favorite).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Secret history" }));
    expect(onHistory).toHaveBeenCalled();
  });
});
