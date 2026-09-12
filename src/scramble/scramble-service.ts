import type { Puzzle } from "../types";

export async function generateScramble(puzzle: Puzzle): Promise<string> {
  // cubing.jsはWorkerからも共有モジュールを読み込む。アプリ本体と静的に
  // 結合するとDOM依存コードがWorkerチャンクへ混入するため、境界を分ける。
  const { randomScrambleForEvent } = await import("cubing/scramble");
  const scramble = (await randomScrambleForEvent(puzzle)).toString().trim();
  if (!scramble) throw new Error("空のスクランブルが生成されました");
  return scramble;
}
