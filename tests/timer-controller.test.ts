import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimerController, type TimerClock } from "../src/timer/timer-controller";
import type { TimerState } from "../src/types";

class FakeClock implements TimerClock {
  time = 0;
  private nextId = 1;
  private timeouts = new Map<number, { at: number; callback: () => void }>();
  private frames = new Map<number, FrameRequestCallback>();

  now(): number { return this.time; }
  requestFrame(callback: FrameRequestCallback): number {
    const id = this.nextId++;
    this.frames.set(id, callback);
    return id;
  }
  cancelFrame(id: number): void { this.frames.delete(id); }
  setTimeout(callback: () => void, delay: number): number {
    const id = this.nextId++;
    this.timeouts.set(id, { at: this.time + delay, callback });
    return id;
  }
  clearTimeout(id: number): void { this.timeouts.delete(id); }

  advance(ms: number): void {
    this.time += ms;
    for (const [id, timeout] of [...this.timeouts]) {
      if (timeout.at <= this.time) {
        this.timeouts.delete(id);
        timeout.callback();
      }
    }
  }

  runFrame(): void {
    const callbacks = [...this.frames.values()];
    this.frames.clear();
    callbacks.forEach((callback) => callback(this.time));
  }
}

describe("TimerController", () => {
  let pad: HTMLButtonElement;
  let clock: FakeClock;
  let states: TimerState[];
  let displays: string[];
  let stop: ReturnType<typeof vi.fn<(elapsed: number) => void>>;
  let timer: TimerController;

  beforeEach(() => {
    pad = document.createElement("button");
    pad.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, x: 0, y: 0, toJSON: () => ({}) });
    clock = new FakeClock();
    states = [];
    displays = [];
    stop = vi.fn();
    timer = new TimerController(pad, {
      onStateChange: (state) => states.push(state),
      onDisplayChange: (text) => displays.push(text),
      onStop: stop,
      canStart: () => true
    }, clock);
  });

  it("500ms未満では開始しない", () => {
    timer.pointerDown({ pointerId: 1, isPrimary: true });
    clock.advance(499);
    timer.pointerUp({ pointerId: 1 });
    expect(timer.getState()).toBe("IDLE");
    expect(states).toEqual(["HOLDING", "IDLE"]);
  });

  it("500ms保持して離すと計測を開始する", () => {
    timer.pointerDown({ pointerId: 1, isPrimary: true });
    clock.advance(500);
    timer.pointerUp({ pointerId: 1 });
    expect(timer.getState()).toBe("RUNNING");
    expect(states).toEqual(["HOLDING", "READY", "RUNNING"]);
  });

  it("経過時間をフレーム数ではなく時計から表示する", () => {
    startTimer();
    clock.advance(1_239);
    clock.runFrame();
    expect(displays.at(-1)).toBe("1.23");
  });

  it("同じ表示文字列では更新を通知しない", () => {
    startTimer();
    const count = displays.length;
    clock.advance(1);
    clock.runFrame();
    expect(displays).toHaveLength(count);
  });

  it("RUNNING中のpointerdownで即時停止する", () => {
    startTimer();
    clock.advance(12_459);
    timer.pointerDown({ pointerId: 2, isPrimary: true });
    expect(timer.getState()).toBe("STOPPED");
    expect(stop).toHaveBeenCalledWith(12_459);
    expect(displays.at(-1)).toBe("12.45");
    timer.pointerUp({ pointerId: 2 });
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("領域外への移動で開始準備を解除する", () => {
    timer.pointerDown({ pointerId: 1, isPrimary: true });
    timer.pointerMove({ pointerId: 1, clientX: 220, clientY: 50 });
    expect(timer.getState()).toBe("IDLE");
  });

  it("非表示化で計測を中断する", () => {
    startTimer();
    expect(timer.cancelForHidden()).toBe(true);
    expect(timer.getState()).toBe("CANCELLED");
    expect(stop).not.toHaveBeenCalled();
  });

  function startTimer(): void {
    timer.pointerDown({ pointerId: 1, isPrimary: true });
    clock.advance(500);
    timer.pointerUp({ pointerId: 1 });
  }
});
