/**
 * frontend/shell-ws.html に CSS・エンジンバンドル・アプリ本体を埋め込み、
 * 単体で動く frontend/index-ws.html を生成する(自前サーバー・アカウント不要版)。
 *
 * これも Claude Artifact としてではなく、ダウンロードして配布・共有するための
 * 単体HTMLファイル。接続先の中継サーバー(server/server.js)は別途自分で
 * 用意・デプロイする必要がある(server/README.md 参照)。
 *
 * 事前に `npm run build`(tsc)と `npm run bundle` を済ませておくこと。
 */
const fs = require("fs");
const path = require("path");

const frontendDir = path.join(__dirname, "frontend");

const shellPath = path.join(frontendDir, "shell-ws.html");
const bundlePath = path.join(frontendDir, "mahjong-engine.bundle.js");

if (!fs.existsSync(bundlePath)) {
  console.error("エンジンバンドルがありません。先に `npm run build && npm run bundle` を実行してください。");
  process.exit(1);
}

const replacements = [
  ["/*STYLES_PLACEHOLDER*/", path.join(frontendDir, "styles.css")],
  ["/*ENGINE_PLACEHOLDER*/", bundlePath],
  ["/*APP_PLACEHOLDER*/", path.join(frontendDir, "app.js")],
  ["/*ONLINE_SHARED_PLACEHOLDER*/", path.join(frontendDir, "online-shared.js")],
  ["/*WS_PLACEHOLDER*/", path.join(frontendDir, "ws.js")],
];

let html = fs.readFileSync(shellPath, "utf8");

// 効果音(frontend/sounds/*.mp3)を data URL にして埋め込む。ファイル名(拡張子なし)がそのまま
// 音の名前になる(例: dahai1.mp3 → "dahai1")。app.js は MAHJONG_SOUND_FILES があればそれを使う。
// 音を差し替えたい場合は、同じ名前のファイルを置き換えて再ビルドすればよい。
const soundsDir = path.join(frontendDir, "sounds");
const soundFiles = {};
if (fs.existsSync(soundsDir)) {
  for (const name of fs.readdirSync(soundsDir).sort()) {
    const m = /^(.+)\.(mp3|m4a|ogg|wav)$/i.exec(name);
    if (!m) continue;
    const mime = { mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg", wav: "audio/wav" }[m[2].toLowerCase()];
    const b64 = fs.readFileSync(path.join(soundsDir, name)).toString("base64");
    soundFiles[m[1]] = `data:${mime};base64,${b64}`;
  }
}
const soundScript = `const MAHJONG_SOUND_FILES = ${JSON.stringify(soundFiles)};\n`;

for (const [placeholder, filePath] of replacements) {
  const content = fs.readFileSync(filePath, "utf8");
  if (/<\/(script|style)/i.test(content)) {
    console.error(`${path.basename(filePath)} に </script> または </style> が含まれています。インライン展開できません。`);
    process.exit(1);
  }
  if (!html.includes(placeholder)) {
    console.error(`shell-ws.html に ${placeholder} が見つかりません。`);
    process.exit(1);
  }
  const inserted = placeholder === "/*APP_PLACEHOLDER*/" ? soundScript + content : content;
  // 置換文字列中の "$&" などが特殊な意味にならないよう、関数で置換する
  html = html.replace(placeholder, () => inserted);
}

const outPath = path.join(frontendDir, "index-ws.html");
fs.writeFileSync(outPath, html);
console.log(`index-ws.html を生成しました (${fs.statSync(outPath).size} bytes、効果音 ${Object.keys(soundFiles).length} 個)`);
