import { HOLD_DURATION_MS } from "../constants";
import type { TimerState } from "../types";
import { formatTime } from "./time-format";

export interface TimerCallbacks {
  onStateChange(state: TimerState): void;
  onDisplayChange(text: string): void;
  onStop(elapsedMs: number): void;
  canStart(): boolean;
}

export interface TimerClock {
  now(): number;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
  setTimeout(callback: () => void, delay: number): number;
  clearTimeout(id: number): void;
}

const browserClock: TimerClock = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  setTimeout: (callback, delay) => window.setTimeout(callback, delay),
  clearTimeout: (id) => window.clearTimeout(id)
};

export class TimerController {
  private state: TimerState = "IDLE";
  private activePointerId: number | null = null;
  private holdTimeoutId: number | null = null;
  private startedAt = 0;
  private animationFrameId: number | null = null;
  private lastRenderedText = "0.00";
  private ignoredStopPointerId: number | null = null;
  private readonly pad: HTMLElement;
  private readonly callbacks: TimerCallbacks;
  private readonly clock: TimerClock;

  constructor(pad: HTMLElement, callbacks: TimerCallbacks, clock: TimerClock = browserClock) {
    this.pad = pad;
    this.callbacks = callbacks;
    this.clock = clock;
  }

  getState(): TimerState { return this.state; }

  pointerDown(event: Pick<PointerEvent, "pointerId" | "isPrimary">): void {
    if (this.state === "RUNNING") {
      if (!event.isPrimary) return;
      const stoppedAt = this.clock.now();
      this.cancelAnimation();
      this.ignoredStopPointerId = event.pointerId;
      this.setState("STOPPED");
      const elapsed = Math.max(0, stoppedAt - this.startedAt);
      this.render(formatTime(elapsed));
      this.callbacks.onStop(elapsed);
      return;
    }

    if (this.state !== "IDLE" || !event.isPrimary || !this.callbacks.canStart()) {
      if (this.state === "HOLDING" || this.state === "READY") this.cancelPreparation();
      return;
    }

    this.activePointerId = event.pointerId;
    if ("setPointerCapture" in this.pad) {
      try { this.pad.setPointerCapture(event.pointerId); } catch { /* capture is best effort */ }
    }
    this.setState("HOLDING");
    this.holdTimeoutId = this.clock.setTimeout(() => {
      this.holdTimeoutId = null;
      if (this.state === "HOLDING" && this.activePointerId === event.pointerId) this.setState("READY");
    }, HOLD_DURATION_MS);
  }

  pointerUp(event: Pick<PointerEvent, "pointerId">): void {
    if (this.ignoredStopPointerId === event.pointerId) {
      this.ignoredStopPointerId = null;
      return;
    }
    if (event.pointerId !== this.activePointerId) return;

    if (this.state === "READY") {
      this.clearHoldTimeout();
      this.activePointerId = null;
      this.startedAt = this.clock.now();
      this.lastRenderedText = "0.00";
      this.callbacks.onDisplayChange("0.00");
      this.setState("RUNNING");
      this.animationFrameId = this.clock.requestFrame(this.frame);
      return;
    }
    if (this.state === "HOLDING") this.cancelPreparation();
  }

  pointerMove(event: Pick<PointerEvent, "pointerId" | "clientX" | "clientY">): void {
    if ((this.state !== "HOLDING" && this.state !== "READY") || event.pointerId !== this.activePointerId) return;
    const rect = this.pad.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) {
      this.cancelPreparation();
    }
  }

  pointerCancel(event: Pick<PointerEvent, "pointerId">): void {
    if (event.pointerId === this.activePointerId) this.cancelPreparation();
  }

  cancelForHidden(): boolean {
    if (this.state === "RUNNING") {
      this.cancelAnimation();
      this.setState("CANCELLED");
      return true;
    }
    if (this.state === "HOLDING" || this.state === "READY") this.cancelPreparation();
    return false;
  }

  reset(): void {
    this.clearHoldTimeout();
    this.cancelAnimation();
    this.activePointerId = null;
    this.ignoredStopPointerId = null;
    this.setState("IDLE");
  }

  setExternalState(state: "SAVE_FAILED" | "IDLE"): void { this.setState(state); }

  private readonly frame = (now: number): void => {
    if (this.state !== "RUNNING") return;
    this.render(formatTime(now - this.startedAt));
    this.animationFrameId = this.clock.requestFrame(this.frame);
  };

  private render(text: string): void {
    if (text === this.lastRenderedText) return;
    this.lastRenderedText = text;
    this.callbacks.onDisplayChange(text);
  }

  private cancelPreparation(): void {
    this.clearHoldTimeout();
    this.activePointerId = null;
    this.setState("IDLE");
  }

  private clearHoldTimeout(): void {
    if (this.holdTimeoutId !== null) this.clock.clearTimeout(this.holdTimeoutId);
    this.holdTimeoutId = null;
  }

  private cancelAnimation(): void {
    if (this.animationFrameId !== null) this.clock.cancelFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  private setState(state: TimerState): void {
    if (state === this.state) return;
    this.state = state;
    this.callbacks.onStateChange(state);
  }
}
