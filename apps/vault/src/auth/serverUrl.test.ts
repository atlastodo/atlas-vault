import {
  defaultServerUrl,
  loadServerUrl,
  normalizeServerUrl,
  setServerUrlOverride,
} from "./serverUrl";

describe("server URL", () => {
  it("normalizes what the user types", () => {
    expect(normalizeServerUrl(" atlas.example.com/api/ ")).toBe("https://atlas.example.com/api");
    expect(normalizeServerUrl("http://localhost:8080")).toBe("http://localhost:8080");
    expect(normalizeServerUrl("   ")).toBe("");
  });

  it("keeps an override until it is cleared", async () => {
    const fallback = defaultServerUrl();
    await setServerUrlOverride("atlas.example.com");
    expect(await loadServerUrl()).toBe("https://atlas.example.com");
    await setServerUrlOverride("");
    expect(await loadServerUrl()).toBe(fallback);
  });
});
