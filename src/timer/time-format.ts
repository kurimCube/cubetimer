export function formatTime(timeMs: number): string {
  const centiseconds = Math.floor(Math.max(0, timeMs) / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor((centiseconds % 6000) / 100);
  const fraction = centiseconds % 100;
  const tail = `${String(seconds).padStart(minutes > 0 ? 2 : 1, "0")}.${String(fraction).padStart(2, "0")}`;
  return minutes > 0 ? `${minutes}:${tail}` : tail;
}
