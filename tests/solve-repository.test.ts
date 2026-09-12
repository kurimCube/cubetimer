import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DB_NAME } from "../src/constants";
import { SolveRepository } from "../src/storage/solve-repository";
import type { Puzzle, Solve } from "../src/types";

describe("SolveRepository", () => {
  let repository: SolveRepository;

  beforeEach(async () => {
    await deleteDatabase();
    repository = new SolveRepository();
    await repository.open();
  });

  afterEach(async () => {
    repository.close();
    await deleteDatabase();
  });

  it("保存時に連番IDを返し、新しい順に取得する", async () => {
    const first = await repository.add(makeSolve("333", 1_000, 100));
    const second = await repository.add(makeSolve("333", 2_000, 200));
    expect(first).toBe(1);
    expect(second).toBe(2);
    const solves = await repository.listRecent("333", 5);
    expect(solves.map((solve) => solve.timeMs)).toEqual([2_000, 1_000]);
  });

  it("種目で絞り込む", async () => {
    await repository.add(makeSolve("333", 1_000, 100));
    await repository.add(makeSolve("777", 2_000, 200));
    expect((await repository.listRecent("333", 5)).map((solve) => solve.puzzle)).toEqual(["333"]);
  });

  it("カーソルで重複なくページングする", async () => {
    for (let index = 0; index < 5; index += 1) {
      await repository.add(makeSolve("333", index * 100, 1_000 + index));
    }
    const first = await repository.listPage(null, 2);
    const second = await repository.listPage(null, 2, first.nextCursor ?? undefined);
    const third = await repository.listPage(null, 2, second.nextCursor ?? undefined);
    expect([...first.solves, ...second.solves, ...third.solves].map((solve) => solve.id)).toEqual([5, 4, 3, 2, 1]);
    expect(third.nextCursor).toBeNull();
  });

  it("指定した記録を削除する", async () => {
    const id = await repository.add(makeSolve("333", 1_000, 100));
    await repository.delete(id);
    expect(await repository.listRecent("333", 5)).toEqual([]);
  });
});

function makeSolve(puzzle: Puzzle, timeMs: number, createdAt: number): Solve {
  return { puzzle, timeMs, createdAt, scramble: "R U R'", penalty: "none" };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("DB deletion blocked"));
  });
}
