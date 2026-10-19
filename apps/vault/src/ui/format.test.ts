import { KIND_LABELS, MASK, typeLabel } from "./format";

describe("format", () => {
  it("labels types, keeping unknown ones", () => {
    expect(typeLabel("ssh_key")).toBe("SSH key");
    expect(typeLabel("future_type")).toBe("future_type");
    expect(KIND_LABELS.totp).toBe("TOTP");
  });

  it("masks without giving away a length", () => {
    expect(MASK).toHaveLength(12);
  });
});
