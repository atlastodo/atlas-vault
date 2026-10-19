import { fireEvent, render, screen } from "@testing-library/react-native";
import { memoryVault } from "../test/vault";
import { ItemsScreen } from "./ItemsScreen";

async function setup() {
  const vault = memoryVault();
  const ci = vault.items.createFolder("CI");
  vault.items.create({
    name: "Deploy key",
    type: "api_key",
    folder: ci.id,
    tags: ["prod"],
    fields: [{ name: "token", kind: "hidden", value: "sk_live_secret" }],
  });
  vault.items.create({
    name: "GitHub",
    favorite: true,
    fields: [{ name: "username", value: "octocat" }],
  });
  const onOpen = jest.fn();
  await render(
    <vault.Provider>
      <ItemsScreen
        onOpen={onOpen}
        onNew={jest.fn()}
        onSettings={jest.fn()}
        onGenerator={jest.fn()}
        onLock={jest.fn()}
      />
    </vault.Provider>,
  );
  return { vault, onOpen };
}

const names = () =>
  screen.queryAllByRole("button", { name: /^Open / }).map((b) => b.props.accessibilityLabel);

describe("ItemsScreen", () => {
  it("lists items by name with their account", async () => {
    const { onOpen } = await setup();
    expect(names()).toEqual(["Open Deploy key", "Open GitHub"]);
    expect(screen.getByText("octocat")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Open GitHub" }));
    expect(onOpen).toHaveBeenCalled();
  });

  it("searches names and usernames, never secrets", async () => {
    await setup();
    await fireEvent.changeText(screen.getByLabelText("Search the vault"), "octo");
    expect(names()).toEqual(["Open GitHub"]);
    await fireEvent.changeText(screen.getByLabelText("Search the vault"), "sk_live");
    expect(names()).toEqual([]);
    expect(screen.getByText("No items match.")).toBeTruthy();
  });

  it("filters by favorites, folder, type and tag", async () => {
    await setup();
    await fireEvent.press(screen.getByRole("button", { name: "Show Favorites" }));
    expect(names()).toEqual(["Open GitHub"]);
    await fireEvent.press(screen.getByRole("button", { name: "Show CI" }));
    expect(names()).toEqual(["Open Deploy key"]);
    await fireEvent.press(screen.getByRole("button", { name: "Show All" }));
    await fireEvent.press(screen.getByRole("button", { name: "Filter by type Login" }));
    expect(names()).toEqual(["Open GitHub"]);
    await fireEvent.press(screen.getByRole("button", { name: "Filter by type Login" }));
    await fireEvent.press(screen.getByRole("button", { name: "Filter by tag prod" }));
    expect(names()).toEqual(["Open Deploy key"]);
  });
});
