import { fireEvent, render, screen } from "@testing-library/react-native";
import { memoryVault } from "../test/vault";
import { ItemEditorScreen } from "./ItemEditorScreen";

async function setup(id: string | null = null, vault = memoryVault(), initialType?: string) {
  const onDone = jest.fn();
  await render(
    <vault.Provider>
      <ItemEditorScreen id={id} initialType={initialType} onDone={onDone} />
    </vault.Provider>,
  );
  return { vault, onDone };
}

const save = () => fireEvent.press(screen.getAllByRole("button", { name: "Save" })[0]!);

describe("ItemEditorScreen", () => {
  it("creates a login from its template, leaving out the empty fields", async () => {
    const { vault, onDone } = await setup();
    await fireEvent.changeText(screen.getByLabelText("Name"), " GitHub ");
    await fireEvent.changeText(screen.getByLabelText("username value"), "octo");
    await fireEvent.changeText(screen.getByLabelText("password value"), "hunter2");
    await fireEvent.changeText(
      screen.getByLabelText("Websites (one per line)"),
      "https://github.com\n\n",
    );
    await fireEvent.changeText(screen.getByLabelText("Tags (comma-separated)"), "work, dev,");
    await save();
    const [item] = vault.items.list();
    expect(item).toMatchObject({
      type: "login",
      name: "GitHub",
      fields: [
        { name: "username", kind: "text", value: "octo" },
        { name: "password", kind: "hidden", value: "hunter2" },
      ],
      urls: ["https://github.com"],
      tags: ["work", "dev"],
    });
    expect(onDone).toHaveBeenCalledWith(item!.id);
    expect(vault.kicks.count).toBe(1);
  });

  it("masks a hidden value as it is typed", async () => {
    await setup();
    expect(screen.getByLabelText("password value").props.secureTextEntry).toBe(true);
    await fireEvent.press(screen.getByRole("button", { name: "Reveal password value" }));
    expect(screen.getByLabelText("password value").props.secureTextEntry).toBe(false);
  });

  it("fills a hidden field from the generator", async () => {
    const { vault } = await setup();
    await fireEvent.changeText(screen.getByLabelText("Name"), "Router");
    await fireEvent.press(screen.getByRole("button", { name: "Generate password" }));
    await fireEvent.press(screen.getByRole("button", { name: "Use it" }));
    await save();
    const password = vault.items.list()[0]!.fields.find((f) => f.name === "password")!.value;
    expect(password).toHaveLength(20);
  });

  it("starts each type from its own template", async () => {
    await setup(null, memoryVault(), "card");
    expect(screen.getByLabelText("number value")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Type: SSH key" }));
    expect(screen.getByLabelText("private key value")).toBeTruthy();
  });

  it("says what the shared rules refuse instead of saving", async () => {
    const { onDone } = await setup();
    await save();
    expect(screen.getByText("A vault item needs a name.")).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText("Name"), "x");
    await fireEvent.press(screen.getByRole("radio", { name: "totp kind TOTP" }));
    await fireEvent.changeText(screen.getByLabelText("totp value"), "not base32!");
    await save();
    expect(screen.getByText(/needs an otpauth:\/\/ URI or a base32 secret/)).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps a changed password in the history", async () => {
    const vault = memoryVault();
    const made = vault.items.create({
      name: "Mail",
      fields: [{ name: "password", kind: "hidden", value: "old" }],
    });
    await setup(made.id, vault);
    await fireEvent.changeText(screen.getByLabelText("password value"), "new");
    await save();
    const item = vault.items.get(made.id)!;
    expect(item.fields[0]!.value).toBe("new");
    expect(item.history.map((h) => [h.field, h.value])).toEqual([["password", "old"]]);
  });
});
