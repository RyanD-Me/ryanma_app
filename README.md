# 二麻オンライン(独自ルールの二人麻雀)

ブラウザで遊べる二人麻雀です。公開ページはリポジトリ直下の `index.html`(GitHub Pages で配信)。

- 開発・ビルド・公開の手順、これまでの仕様の決定事項は **`CLAUDE.md`** にまとめています。
- ビルド: `npm install` → `npm run release`(`frontend/index-ws.html` を生成し、直下の `index.html` にコピー)
- テスト: `npm test`
- オンライン対戦の中継サーバー: `server/`(デプロイ方法は `server/README.md`)
