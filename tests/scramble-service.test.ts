// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateScramble } from "../src/scramble/scramble-service";

describe("generateScramble", () => {
  it.each(["333", "777"] as const)("%sのスクランブルを生成する", async (puzzle) => {
    const scramble = await generateScramble(puzzle);
    expect(scramble.length).toBeGreaterThan(10);
    expect(scramble).not.toMatch(/^\s*$/);
  }, 30_000);
});
