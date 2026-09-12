type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void, options?: AddEventListenerOptions): void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> };
};

export class WakeLockService {
  private sentinel: WakeLockSentinelLike | null = null;
  private acquiring: Promise<void> | null = null;

  acquire(): Promise<void> {
    const wakeLock = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLock || document.visibilityState !== "visible" || (this.sentinel && !this.sentinel.released)) {
      return Promise.resolve();
    }
    if (this.acquiring) return this.acquiring;

    this.acquiring = wakeLock.request("screen")
      .then((sentinel) => {
        this.sentinel = sentinel;
        sentinel.addEventListener("release", () => {
          if (this.sentinel === sentinel) this.sentinel = null;
        }, { once: true });
      })
      .catch(() => undefined)
      .finally(() => { this.acquiring = null; });
    return this.acquiring;
  }

  async release(): Promise<void> {
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel && !sentinel.released) await sentinel.release().catch(() => undefined);
  }

  handleHidden(): void {
    this.sentinel = null;
    this.acquiring = null;
  }
}
