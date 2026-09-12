import { DB_NAME, DB_VERSION, SOLVE_STORE_NAME } from "../constants";
import type { HistoryCursor, HistoryPage, Puzzle, Solve } from "../types";

export class SolveRepository {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;

    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        const store = db.objectStoreNames.contains(SOLVE_STORE_NAME)
          ? request.transaction!.objectStore(SOLVE_STORE_NAME)
          : db.createObjectStore(SOLVE_STORE_NAME, { keyPath: "id", autoIncrement: true });

        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt", { unique: false });
        if (!store.indexNames.contains("puzzle")) store.createIndex("puzzle", "puzzle", { unique: false });
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (this.db === db) this.db = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした"));
      request.onblocked = () => reject(new Error("別の画面がデータベースの更新を妨げています"));
    });
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  async add(solve: Solve): Promise<number> {
    const db = this.requireDb();
    return new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(SOLVE_STORE_NAME, "readwrite");
      const request = transaction.objectStore(SOLVE_STORE_NAME).add(solve);
      let id: number | null = null;
      request.onsuccess = () => { id = Number(request.result); };
      transaction.oncomplete = () => id === null ? reject(new Error("保存結果を取得できませんでした")) : resolve(id);
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("保存に失敗しました"));
      transaction.onabort = () => reject(transaction.error ?? new Error("保存が中断されました"));
    });
  }

  async delete(id: number): Promise<void> {
    const db = this.requireDb();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(SOLVE_STORE_NAME, "readwrite");
      transaction.objectStore(SOLVE_STORE_NAME).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("削除に失敗しました"));
      transaction.onabort = () => reject(transaction.error ?? new Error("削除が中断されました"));
    });
  }

  async listRecent(puzzle: Puzzle, limit: number): Promise<Solve[]> {
    const page = await this.listPage(puzzle, limit);
    return page.solves;
  }

  async listPage(filter: Puzzle | null, limit: number, cursor?: HistoryCursor): Promise<HistoryPage> {
    const db = this.requireDb();
    return new Promise<HistoryPage>((resolve, reject) => {
      const transaction = db.transaction(SOLVE_STORE_NAME, "readonly");
      const index = transaction.objectStore(SOLVE_STORE_NAME).index("createdAt");
      const range = cursor ? IDBKeyRange.upperBound(cursor.createdAt) : null;
      const request = index.openCursor(range, "prev");
      const solves: Solve[] = [];
      let hasMore = false;

      request.onsuccess = () => {
        const dbCursor = request.result;
        if (!dbCursor) return;
        const value = dbCursor.value as Solve;
        const id = Number(value.id);

        if (cursor && value.createdAt === cursor.createdAt && id >= cursor.id) {
          dbCursor.continue();
          return;
        }

        if ((!filter || value.puzzle === filter) && isValidSolve(value)) {
          if (solves.length === limit) {
            hasMore = true;
            return;
          }
          solves.push(value);
        }
        dbCursor.continue();
      };

      transaction.oncomplete = () => {
        const last = solves.at(-1);
        resolve({
          solves,
          nextCursor: hasMore && last?.id !== undefined ? { createdAt: last.createdAt, id: last.id } : null
        });
      };
      transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error("履歴を取得できませんでした"));
      transaction.onabort = () => reject(transaction.error ?? new Error("履歴の取得が中断されました"));
    });
  }

  private requireDb(): IDBDatabase {
    if (!this.db) throw new Error("IndexedDBが初期化されていません");
    return this.db;
  }
}

function isValidSolve(value: Solve): boolean {
  return (value.puzzle === "333" || value.puzzle === "777")
    && Number.isFinite(value.timeMs) && value.timeMs >= 0
    && typeof value.scramble === "string"
    && Number.isFinite(value.createdAt)
    && (value.penalty === "none" || value.penalty === "plus2" || value.penalty === "dnf");
}
