import { HISTORY_PAGE_SIZE, LAST_PUZZLE_KEY } from "./constants";
import { WakeLockService } from "./platform/wake-lock-service";
import { generateScramble } from "./scramble/scramble-service";
import { SolveRepository } from "./storage/solve-repository";
import { TimerController } from "./timer/timer-controller";
import { formatTime } from "./timer/time-format";
import type { HistoryCursor, HistoryFilter, Penalty, Puzzle, Solve, TimerState } from "./types";

interface ScrambleSlot {
  value: string | null;
  requestId: number;
  status: "empty" | "loading" | "ready" | "error";
}

interface Elements {
  timerView: HTMLElement;
  historyView: HTMLElement;
  puzzleButtons: NodeListOf<HTMLButtonElement>;
  scramble: HTMLElement;
  scrambleRetry: HTMLButtonElement;
  timerPad: HTMLButtonElement;
  timerOutput: HTMLOutputElement;
  timerInstruction: HTMLElement;
  runningStopOverlay: HTMLButtonElement;
  runningTimerOutput: HTMLOutputElement;
  latestActions: HTMLElement;
  latestPlus2: HTMLButtonElement;
  latestDnf: HTMLButtonElement;
  latestDelete: HTMLButtonElement;
  openHistory: HTMLButtonElement;
  closeHistory: HTMLButtonElement;
  historyFilters: HTMLElement;
  historyStatus: HTMLElement;
  historyList: HTMLOListElement;
  loadMore: HTMLButtonElement;
  saveError: HTMLElement;
  saveRetry: HTMLButtonElement;
  saveDiscard: HTMLButtonElement;
  confirmDialog: HTMLDialogElement;
  confirmTitle: HTMLElement;
  confirmMessage: HTMLElement;
  updateBanner: HTMLElement;
  applyUpdate: HTMLButtonElement;
}

export class AppController {
  private readonly elements: Elements;
  private readonly repository = new SolveRepository();
  private readonly wakeLock = new WakeLockService();
  private readonly timer: TimerController;
  private puzzle: Puzzle = "333";
  private storageReady = false;
  private saving = false;
  private pendingSolve: Solve | null = null;
  private view: "timer" | "history" = "timer";
  private historyFilter: HistoryFilter = "all";
  private historyCursor: HistoryCursor | undefined;
  private historyLoadId = 0;
  private historyBusy = false;
  private latestSolve: Solve | null = null;
  private updateAvailable = false;
  private applyUpdateCallback: (() => Promise<void>) | null = null;
  private readonly scrambleSlots: Record<Puzzle, ScrambleSlot> = {
    "333": { value: null, requestId: 0, status: "empty" },
    "777": { value: null, requestId: 0, status: "empty" }
  };

  constructor() {
    this.elements = collectElements();
    this.puzzle = this.restorePuzzle();
    this.timer = new TimerController(this.elements.timerPad, {
      onStateChange: (state) => this.renderTimerState(state),
      onDisplayChange: (text) => {
        this.elements.timerOutput.value = text;
        this.elements.runningTimerOutput.value = text;
      },
      onStop: (elapsedMs) => { void this.saveStoppedSolve(elapsedMs); },
      canStart: () => this.canStart()
    });
  }

  async start(): Promise<void> {
    this.bindEvents();
    this.renderPuzzleSelection();
    this.setTimerAvailability();

    try {
      await this.repository.open();
      this.storageReady = true;
      await Promise.all([this.loadRecent(), this.ensureScramble(this.puzzle)]);
      this.timer.reset();
      this.setTimerAvailability();
    } catch (error) {
      console.error("アプリの初期化に失敗しました", error);
      this.storageReady = false;
      this.elements.scramble.textContent = "履歴を保存できないため計測を開始できません";
      this.elements.timerInstruction.textContent = "再読み込みしてください";
      this.elements.timerPad.disabled = true;
    }

    void this.wakeLock.acquire();
  }

  setUpdateHandler(handler: () => Promise<void>): void {
    this.applyUpdateCallback = handler;
  }

  showUpdateAvailable(): void {
    this.updateAvailable = true;
    this.elements.updateBanner.hidden = false;
    this.renderUpdateAvailability();
  }

  private bindEvents(): void {
    const { timerPad } = this.elements;
    timerPad.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      void this.wakeLock.acquire();
      this.timer.pointerDown(event);
    });
    timerPad.addEventListener("pointerup", (event) => {
      event.preventDefault();
      this.timer.pointerUp(event);
    });
    timerPad.addEventListener("pointermove", (event) => this.timer.pointerMove(event));
    timerPad.addEventListener("pointercancel", (event) => this.timer.pointerCancel(event));
    timerPad.addEventListener("lostpointercapture", (event) => this.timer.pointerCancel(event));
    timerPad.addEventListener("contextmenu", (event) => event.preventDefault());
    this.elements.runningStopOverlay.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.timer.pointerDown(event);
    });
    this.elements.runningStopOverlay.addEventListener("pointerup", (event) => {
      event.preventDefault();
      this.timer.pointerUp(event);
    });
    this.elements.runningStopOverlay.addEventListener("pointercancel", (event) => this.timer.pointerCancel(event));
    this.elements.runningStopOverlay.addEventListener("contextmenu", (event) => event.preventDefault());

    document.addEventListener("keydown", (event) => {
      if (event.code !== "Space" || event.repeat || this.shouldIgnoreKeyboardTimer(event.target)) return;
      event.preventDefault();
      this.timer.pointerDown({ pointerId: -1, isPrimary: true });
    });
    document.addEventListener("keyup", (event) => {
      if (event.code !== "Space" || this.shouldIgnoreKeyboardTimer(event.target)) return;
      event.preventDefault();
      this.timer.pointerUp({ pointerId: -1 });
    });

    this.elements.puzzleButtons.forEach((button) => {
      button.addEventListener("click", () => void this.changePuzzle(button.dataset.puzzle as Puzzle));
    });
    this.elements.scrambleRetry.addEventListener("click", () => void this.ensureScramble(this.puzzle, true));
    this.elements.openHistory.addEventListener("click", () => void this.openHistory());
    this.elements.latestActions.addEventListener("click", (event) => void this.handleLatestAction(event));
    this.elements.closeHistory.addEventListener("click", () => this.closeHistory());
    this.elements.historyFilters.addEventListener("click", (event) => {
      const button = (event.target as Element).closest<HTMLButtonElement>("button[data-filter]");
      if (button) void this.setHistoryFilter(button.dataset.filter as HistoryFilter);
    });
    this.elements.historyList.addEventListener("click", (event) => void this.handleHistoryClick(event));
    this.elements.loadMore.addEventListener("click", () => void this.loadHistoryPage(false));
    this.elements.saveRetry.addEventListener("click", () => void this.retrySave());
    this.elements.saveDiscard.addEventListener("click", () => void this.discardPendingSolve());
    this.elements.applyUpdate.addEventListener("click", () => void this.applyUpdate());

    document.addEventListener("visibilitychange", () => this.handleVisibilityChange());
    window.addEventListener("pagehide", () => {
      this.timer.cancelForHidden();
      this.wakeLock.handleHidden();
    });
    window.addEventListener("beforeunload", (event) => {
      if (!this.pendingSolve) return;
      event.preventDefault();
    });
  }

  private canStart(): boolean {
    return this.storageReady
      && !this.saving
      && !this.pendingSolve
      && this.view === "timer"
      && this.scrambleSlots[this.puzzle].status === "ready";
  }

  private setTimerAvailability(): void {
    this.elements.timerPad.disabled = !this.canStart() && this.timer.getState() === "IDLE";
    this.renderControlsDisabled();
  }

  private renderTimerState(state: TimerState): void {
    this.elements.timerPad.dataset.state = state;
    this.elements.runningStopOverlay.hidden = state !== "RUNNING";
    const messages: Record<TimerState, string> = {
      IDLE: this.scrambleSlots[this.puzzle].status === "ready" ? "長押しで開始" : "準備中",
      HOLDING: "そのまま長押し",
      READY: "離してスタート",
      RUNNING: "タップでストップ",
      STOPPED: this.saving ? "保存中" : "タイム確定",
      CANCELLED: "計測を中断しました",
      SAVE_FAILED: "保存を再試行してください"
    };
    this.elements.timerInstruction.textContent = messages[state];
    this.renderControlsDisabled();
    this.renderUpdateAvailability();
  }

  private renderControlsDisabled(): void {
    const state = this.timer.getState();
    const locked = state !== "IDLE" || this.saving || this.pendingSolve !== null;
    this.elements.puzzleButtons.forEach((button) => { button.disabled = locked; });
    this.elements.openHistory.disabled = locked;
    this.elements.scrambleRetry.disabled = locked;
    this.elements.latestActions.querySelectorAll<HTMLButtonElement>("button[data-latest-action]").forEach((button) => { button.disabled = locked; });
    this.renderLatestActions();
  }

  private async saveStoppedSolve(elapsedMs: number): Promise<void> {
    const scramble = this.scrambleSlots[this.puzzle].value;
    if (!scramble) return;
    this.pendingSolve = {
      puzzle: this.puzzle,
      timeMs: elapsedMs,
      scramble,
      createdAt: Date.now(),
      penalty: "none"
    };
    this.saving = true;
    this.elements.timerInstruction.textContent = "保存中";
    this.renderControlsDisabled();
    await this.performSave();
  }

  private async performSave(): Promise<void> {
    if (!this.pendingSolve) return;
    const solve = this.pendingSolve;
    try {
      const id = await this.repository.add(solve);
      solve.id = id;
      this.pendingSolve = null;
      this.saving = false;
      this.elements.saveError.hidden = true;
      this.scrambleSlots[solve.puzzle] = { value: null, requestId: this.scrambleSlots[solve.puzzle].requestId, status: "empty" };
      await this.loadRecent();
      await this.ensureScramble(solve.puzzle, true);
      this.timer.reset();
      this.setTimerAvailability();
    } catch (error) {
      console.error("タイムの保存に失敗しました", error);
      this.saving = false;
      this.timer.setExternalState("SAVE_FAILED");
      this.elements.saveError.hidden = false;
      this.renderControlsDisabled();
    }
  }

  private async retrySave(): Promise<void> {
    if (!this.pendingSolve || this.saving) return;
    this.saving = true;
    this.elements.saveError.hidden = true;
    this.elements.timerInstruction.textContent = "保存中";
    await this.performSave();
  }

  private async discardPendingSolve(): Promise<void> {
    if (!this.pendingSolve || this.saving) return;
    const confirmed = await this.confirm("未保存タイムの破棄", "このタイムは履歴に残りません。破棄しますか？");
    if (!confirmed) return;
    this.pendingSolve = null;
    this.elements.saveError.hidden = true;
    this.timer.reset();
    this.setTimerAvailability();
  }

  private async ensureScramble(puzzle: Puzzle, force = false): Promise<void> {
    const slot = this.scrambleSlots[puzzle];
    if (!force && (slot.status === "ready" || slot.status === "loading")) {
      if (puzzle === this.puzzle) this.renderScramble();
      return;
    }
    const requestId = slot.requestId + 1;
    slot.requestId = requestId;
    slot.status = "loading";
    slot.value = null;
    if (puzzle === this.puzzle) this.renderScramble();

    try {
      const value = await generateScramble(puzzle);
      const current = this.scrambleSlots[puzzle];
      if (current.requestId !== requestId) return;
      current.value = value;
      current.status = "ready";
    } catch (error) {
      console.error("スクランブル生成に失敗しました", error);
      const current = this.scrambleSlots[puzzle];
      if (current.requestId !== requestId) return;
      current.status = "error";
      current.value = null;
    }
    if (puzzle === this.puzzle) {
      this.renderScramble();
      this.setTimerAvailability();
    }
  }

  private renderScramble(): void {
    const slot = this.scrambleSlots[this.puzzle];
    this.elements.scramble.classList.toggle("scramble-long", this.puzzle === "777");
    this.elements.scrambleRetry.hidden = slot.status !== "error";
    if (slot.status === "ready") this.elements.scramble.textContent = slot.value;
    else if (slot.status === "error") this.elements.scramble.textContent = "スクランブルを生成できませんでした";
    else this.elements.scramble.textContent = "スクランブル生成中";
  }

  private async changePuzzle(puzzle: Puzzle): Promise<void> {
    if ((puzzle !== "333" && puzzle !== "777") || puzzle === this.puzzle || this.timer.getState() !== "IDLE") return;
    this.puzzle = puzzle;
    this.latestSolve = null;
    this.elements.timerOutput.value = "0.00";
    try { localStorage.setItem(LAST_PUZZLE_KEY, puzzle); } catch { /* preference storage is optional */ }
    this.renderPuzzleSelection();
    this.renderScramble();
    this.setTimerAvailability();
    await Promise.all([this.loadRecent(), this.ensureScramble(puzzle)]);
  }

  private renderPuzzleSelection(): void {
    this.elements.puzzleButtons.forEach((button) => {
      const selected = button.dataset.puzzle === this.puzzle;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-pressed", String(selected));
    });
  }

  private restorePuzzle(): Puzzle {
    try { return localStorage.getItem(LAST_PUZZLE_KEY) === "777" ? "777" : "333"; }
    catch { return "333"; }
  }

  private async loadRecent(): Promise<void> {
    try {
      this.latestSolve = (await this.repository.listRecent(this.puzzle, 1))[0] ?? null;
      if (this.timer.getState() === "IDLE" || this.timer.getState() === "STOPPED") {
        this.elements.timerOutput.value = this.latestSolve ? formatSolveTime(this.latestSolve) : "0.00";
      }
      this.renderLatestActions();
    } catch (error) {
      console.error("直前のタイムを取得できませんでした", error);
    }
  }

  private renderLatestActions(): void {
    const visible = this.latestSolve !== null && this.timer.getState() === "IDLE" && !this.saving && !this.pendingSolve;
    this.elements.latestActions.hidden = !visible;
    if (!this.latestSolve) return;
    const plus2 = this.latestSolve.penalty === "plus2";
    const dnf = this.latestSolve.penalty === "dnf";
    this.elements.latestPlus2.classList.toggle("is-selected", plus2);
    this.elements.latestPlus2.setAttribute("aria-pressed", String(plus2));
    this.elements.latestDnf.classList.toggle("is-selected", dnf);
    this.elements.latestDnf.setAttribute("aria-pressed", String(dnf));
  }

  private async handleLatestAction(event: Event): Promise<void> {
    event.stopPropagation();
    const button = (event.target as Element).closest<HTMLButtonElement>("button[data-latest-action]");
    const solve = this.latestSolve;
    if (!button || !solve || solve.id === undefined || this.timer.getState() !== "IDLE") return;
    const id = solve.id;

    const action = button.dataset.latestAction;
    if (action === "delete") {
      if (!await this.confirm("直前の記録を削除", `${formatSolveTime(solve)}を削除しますか？`)) return;
      await this.performLatestMutation(button, () => this.repository.delete(id), "記録を削除できませんでした");
      return;
    }
    if (action === "plus2" || action === "dnf") {
      const penalty: Penalty = solve.penalty === action ? "none" : action;
      await this.performLatestMutation(button, () => this.repository.updatePenalty(id, penalty), "ペナルティを更新できませんでした");
    }
  }

  private async performLatestMutation(button: HTMLButtonElement, mutation: () => Promise<void>, failureMessage: string): Promise<void> {
    button.disabled = true;
    try {
      await mutation();
      await this.loadRecent();
    } catch (error) {
      console.error(failureMessage, error);
      button.disabled = false;
      this.elements.timerInstruction.textContent = failureMessage;
    }
  }

  private async openHistory(): Promise<void> {
    if (this.timer.getState() !== "IDLE" || this.saving || this.pendingSolve) return;
    this.view = "history";
    this.elements.timerView.hidden = true;
    this.elements.historyView.hidden = false;
    await this.wakeLock.release();
    await this.loadHistoryPage(true);
    this.elements.closeHistory.focus();
  }

  private closeHistory(): void {
    this.historyLoadId += 1;
    this.view = "timer";
    this.elements.historyView.hidden = true;
    this.elements.timerView.hidden = false;
    void this.wakeLock.acquire();
    this.elements.openHistory.focus();
  }

  private async setHistoryFilter(filter: HistoryFilter): Promise<void> {
    if (filter !== "all" && filter !== "333" && filter !== "777") return;
    this.historyFilter = filter;
    this.elements.historyFilters.querySelectorAll<HTMLButtonElement>("button[data-filter]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.filter === filter));
    });
    await this.loadHistoryPage(true);
  }

  private async loadHistoryPage(reset: boolean): Promise<void> {
    if (this.historyBusy && !reset) return;
    const loadId = ++this.historyLoadId;
    this.historyBusy = true;
    if (reset) {
      this.historyCursor = undefined;
      this.elements.historyList.replaceChildren();
    }
    this.elements.historyStatus.textContent = "読み込み中";
    this.elements.loadMore.disabled = true;

    try {
      const page = await this.repository.listPage(
        this.historyFilter === "all" ? null : this.historyFilter,
        HISTORY_PAGE_SIZE,
        this.historyCursor
      );
      if (loadId !== this.historyLoadId) return;
      this.appendHistory(page.solves);
      this.historyCursor = page.nextCursor ?? undefined;
      this.elements.loadMore.hidden = page.nextCursor === null;
      this.elements.historyStatus.textContent = this.elements.historyList.children.length === 0 ? "記録はまだありません" : "";
    } catch (error) {
      if (loadId !== this.historyLoadId) return;
      console.error("履歴を取得できませんでした", error);
      this.elements.historyStatus.textContent = "履歴を読み込めませんでした。もう一度お試しください。";
    } finally {
      if (loadId === this.historyLoadId) {
        this.historyBusy = false;
        this.elements.loadMore.disabled = false;
      }
    }
  }

  private appendHistory(solves: Solve[]): void {
    const fragment = document.createDocumentFragment();
    for (const solve of solves) {
      if (solve.id === undefined) continue;
      const item = document.createElement("li");
      item.className = "history-item";
      item.dataset.id = String(solve.id);

      const top = document.createElement("div");
      top.className = "history-item-top";
      const time = document.createElement("strong");
      time.textContent = formatSolveTime(solve);
      const meta = document.createElement("span");
      meta.textContent = `${solve.puzzle === "333" ? "3×3" : "7×7"} · ${formatDate(solve.createdAt)}`;
      top.append(time, meta);

      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "スクランブルを見る";
      const scramble = document.createElement("p");
      scramble.textContent = solve.scramble;
      details.append(summary, scramble);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "delete-button";
      remove.dataset.action = "delete";
      remove.textContent = "削除";
      remove.setAttribute("aria-label", `${formatTime(solve.timeMs)}の記録を削除`);
      item.append(top, details, remove);
      fragment.append(item);
    }
    this.elements.historyList.append(fragment);
  }

  private async handleHistoryClick(event: Event): Promise<void> {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-action="delete"]');
    const item = button?.closest<HTMLLIElement>("li[data-id]");
    if (!button || !item) return;
    const id = Number(item.dataset.id);
    if (!Number.isInteger(id)) return;
    const label = item.querySelector("strong")?.textContent ?? "この記録";
    if (!await this.confirm("記録を削除", `${label}を削除しますか？`)) return;

    button.disabled = true;
    try {
      await this.repository.delete(id);
      item.remove();
      await this.loadRecent();
      if (this.elements.historyList.children.length === 0) this.elements.historyStatus.textContent = "記録はまだありません";
    } catch (error) {
      console.error("履歴を削除できませんでした", error);
      button.disabled = false;
      this.elements.historyStatus.textContent = "記録を削除できませんでした。";
    }
  }

  private confirm(title: string, message: string): Promise<boolean> {
    this.elements.confirmTitle.textContent = title;
    this.elements.confirmMessage.textContent = message;
    this.elements.confirmDialog.showModal();
    return new Promise((resolve) => {
      this.elements.confirmDialog.addEventListener("close", () => {
        resolve(this.elements.confirmDialog.returnValue === "confirm");
      }, { once: true });
    });
  }

  private handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      const cancelled = this.timer.cancelForHidden();
      this.wakeLock.handleHidden();
      if (cancelled) this.elements.timerInstruction.textContent = "画面が非表示になったため計測を中断しました";
      return;
    }
    if (this.timer.getState() === "CANCELLED") {
      this.timer.reset();
      this.elements.timerInstruction.textContent = "画面が非表示になったため計測を中断しました";
      this.setTimerAvailability();
    }
    if (this.view === "timer") void this.wakeLock.acquire();
  }

  private renderUpdateAvailability(): void {
    if (!this.updateAvailable) return;
    const state = this.timer.getState();
    this.elements.applyUpdate.disabled = this.saving || this.pendingSolve !== null || state !== "IDLE";
  }

  private async applyUpdate(): Promise<void> {
    if (!this.applyUpdateCallback || this.elements.applyUpdate.disabled) return;
    this.elements.applyUpdate.disabled = true;
    await this.applyUpdateCallback();
  }

  private shouldIgnoreKeyboardTimer(target: EventTarget | null): boolean {
    if (this.view !== "timer") return true;
    const element = target as HTMLElement | null;
    return Boolean(element?.closest("input, textarea, select, dialog[open], button:not(#timer-pad)"));
  }
}

function collectElements(): Elements {
  const required = <T extends Element>(selector: string): T => {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`必要な要素がありません: ${selector}`);
    return element;
  };
  return {
    timerView: required("#timer-view"), historyView: required("#history-view"),
    puzzleButtons: document.querySelectorAll<HTMLButtonElement>(".puzzle-button"),
    scramble: required("#scramble"), scrambleRetry: required("#scramble-retry"),
    timerPad: required("#timer-pad"), timerOutput: required("#timer-output"), timerInstruction: required("#timer-instruction"),
    runningStopOverlay: required("#running-stop-overlay"), runningTimerOutput: required("#running-timer-output"),
    latestActions: required("#latest-actions"), latestPlus2: required("#latest-plus2"), latestDnf: required("#latest-dnf"), latestDelete: required("#latest-delete"),
    openHistory: required("#open-history"), closeHistory: required("#close-history"),
    historyFilters: required("#history-filters"), historyStatus: required("#history-status"), historyList: required("#history-list"), loadMore: required("#load-more"),
    saveError: required("#save-error"), saveRetry: required("#save-retry"), saveDiscard: required("#save-discard"),
    confirmDialog: required("#confirm-dialog"), confirmTitle: required("#confirm-title"), confirmMessage: required("#confirm-message"),
    updateBanner: required("#update-banner"), applyUpdate: required("#apply-update")
  };
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(timestamp);
}

function formatSolveTime(solve: Solve): string {
  if (solve.penalty === "dnf") return `DNF (${formatTime(solve.timeMs)})`;
  if (solve.penalty === "plus2") return `${formatTime(solve.timeMs + 2_000)}+`;
  return formatTime(solve.timeMs);
}
