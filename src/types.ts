export type Puzzle = "333" | "777";
export type Penalty = "none" | "plus2" | "dnf";
export type TimerState = "IDLE" | "HOLDING" | "READY" | "RUNNING" | "STOPPED" | "CANCELLED" | "SAVE_FAILED";
export type HistoryFilter = "all" | Puzzle;

export interface Solve {
  id?: number;
  puzzle: Puzzle;
  timeMs: number;
  scramble: string;
  createdAt: number;
  penalty: Penalty;
}

export interface HistoryCursor {
  createdAt: number;
  id: number;
}

export interface HistoryPage {
  solves: Solve[];
  nextCursor: HistoryCursor | null;
}
