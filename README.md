# 軽量キューブタイマー

3×3×3と7×7×7に対応した、オフライン完結型の軽量PWAキューブタイマーです。

## 主な機能

* 500msの長押しによる誤操作防止
* `performance.now()`による計測
* cubing.jsによる3×3・7×7スクランブル生成
* IndexedDBへの端末内保存
* 履歴の絞り込み、追加読み込み、削除
* オフライン起動とPWA更新通知
* Screen Wake Lock対応
* iPhone SE 第2世代の縦画面を基準にしたレスポンシブUI

## 開発

Node.jsとpnpmを使用します。

```sh
pnpm install
pnpm run dev
```

## 検証

```sh
pnpm test
pnpm run typecheck
pnpm run build
```

PWAおよびService Workerの動作は本番ビルドで確認します。

```sh
pnpm run build
pnpm run preview
```

プレビューは`http://localhost:4173/cubetimer/`で確認できます。

## 公開

`main`ブランチへプッシュすると、GitHub Actionsがテスト、型検査、本番ビルドを実行し、成功した成果物をGitHub Pagesへ公開します。

公開URL：<https://kurimcube.github.io/cubetimer/>

## 操作

1. タイマー領域を500ms長押しする
2. 表示が緑色になったら指を離して計測を開始する
3. タイマー領域を再度タップして停止する

PCではSpaceキーの押下・解放でも同じ操作ができます。

## ドキュメント

* [要件定義](./軽量キューブタイマー%20要件定義.md)
* [詳細設計](./軽量キューブタイマー%20詳細設計.md)
