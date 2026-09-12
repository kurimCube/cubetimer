import { randomScrambleForEvent } from "cubing/scramble";
import type { Puzzle } from "../types";

export async function generateScramble(puzzle: Puzzle): Promise<string> {
  const scramble = (await randomScrambleForEvent(puzzle)).toString().trim();
  if (!scramble) throw new Error("空のスクランブルが生成されました");
  return scramble;
}
