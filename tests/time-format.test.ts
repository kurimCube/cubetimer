import { describe, expect, it } from "vitest";
import { formatTime } from "../src/timer/time-format";

describe("formatTime", () => {
  it.each([
    [0, "0.00"],
    [9, "0.00"],
    [10, "0.01"],
    [12_459, "12.45"],
    [59_999, "59.99"],
    [60_000, "1:00.00"],
    [62_389, "1:02.38"]
  ])("%dmsを%sとして表示する", (input, expected) => {
    expect(formatTime(input)).toBe(expected);
  });

  it("負数を0として扱う", () => {
    expect(formatTime(-100)).toBe("0.00");
  });
});
