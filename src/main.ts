// cubing.jsの検索Workerと共有される可能性があるエントリーでは、DOMを
// 直接参照しない。ブラウザのメインスレッドだけでアプリを起動する。
if (typeof document !== "undefined") {
  void import("./bootstrap");
}
