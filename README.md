# Game Yacht

スマートフォンの縦画面で使うことを前提にした、ヨット（Yacht）のスコア計算用静的 Web アプリです。

## 主な機能

- 1-6、CH、4D、FH、SS、BS、YT のスコア候補表示と確定
- 上段合計、ボーナス、合計点の自動計算
- 手入力モードと Roll モードの切り替え
- Undo / Redo
- Reset / New Game の確認
- Help 表示
- ゲーム終了時の結果履歴保存
- プレイ回数、最高点、平均点、直近結果の表示

## 対象

このアプリはスマートフォン専用です。主対象は iPhone の縦画面です。Android スマートフォンでも利用できる範囲で対応しています。PC やタブレット向けの最適化は行っていません。

## ローカルでの起動方法

```bash
python3 -m http.server 8000
```

その後、ブラウザで以下を開きます。

```text
http://localhost:8000/
```

## GitHub Pages での公開

GitHub リポジトリで以下を設定します。

```text
Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: main → Folder: / (root) → Save
```

公開後 URL の形式は以下です。

```text
https://<GitHubユーザー名>.github.io/<リポジトリ名>/
```

このリポジトリでは以下の URL で公開予定です。

```text
https://yappo.github.io/game-yacht/
```

## 使用技術

- HTML
- CSS
- Vanilla JavaScript

npm install、build、GitHub Actions、外部 CDN、外部 API は不要です。

## データ保存

通信は行いません。ゲーム状態、Undo / Redo 履歴、過去の結果は `localStorage` を使って現在の端末とブラウザ内だけに保存されます。

ページをリロードした場合やタブを閉じた場合でも、次回アクセス時に直前のゲーム状態へ復元します。Undo / Redo の履歴も端末内へ保存されるため、再読み込み後も引き続き利用できます。

ブラウザデータを削除すると、ゲーム状態と結果履歴も消えます。プライベートブラウズでは保存が維持されない場合があります。
