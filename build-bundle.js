const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "dist");

// 束ねる対象のディレクトリ。中の .js はすべて自動で取り込むため、
// モジュールを新しく追加してもこのファイルを編集する必要はない。
// (dist直下に置かれる検証用スクリプトは対象外)
const bundledDirs = ["types", "wall", "yaku", "scoring", "game", "ai"];

const moduleIds = bundledDirs.flatMap((dir) =>
  fs
    .readdirSync(path.join(root, dir))
    .filter((name) => name.endsWith(".js"))
    .map((name) => `${dir}/${name.replace(/\.js$/, "")}`)
);

let out = [];
out.push("// 自動生成: TypeScriptソースをコンパイルし、ブラウザ向けに束ねたものです。手編集しないでください。");
out.push("(function(global){");
out.push("  var modules = {};");
out.push("  var cache = {};");
out.push("  function resolvePath(fromId, relId) {");
out.push("    if (relId[0] !== '.') return relId;");
out.push("    var base = fromId.split('/'); base.pop();");
out.push("    var parts = relId.split('/');");
out.push("    for (var i=0;i<parts.length;i++) {");
out.push("      var p = parts[i];");
out.push("      if (p === '.' || p === '') continue;");
out.push("      if (p === '..') base.pop(); else base.push(p);");
out.push("    }");
out.push("    return base.join('/');");
out.push("  }");
out.push("  function requireModule(id) {");
out.push("    if (cache[id]) return cache[id].exports;");
out.push("    var mod = { exports: {} };");
out.push("    cache[id] = mod;");
out.push("    if (!modules[id]) throw new Error('module not found: ' + id);");
out.push("    modules[id](mod, mod.exports, function(rel) { return requireModule(resolvePath(id, rel)); });");
out.push("    return mod.exports;");
out.push("  }");

for (const id of moduleIds) {
  const filePath = path.join(root, id + ".js");
  const content = fs.readFileSync(filePath, "utf8");
  out.push(`  modules[${JSON.stringify(id)}] = function(module, exports, require) {\n${content}\n  };`);
}

out.push("  global.MahjongEngine = Object.assign(");
out.push("    {},");
out.push("    requireModule('types/index'),");
out.push("    requireModule('wall/index'),");
out.push("    requireModule('yaku/index'),");
out.push("    requireModule('scoring/index'),");
out.push("    requireModule('game/index'),");
out.push("    requireModule('ai/index')");
out.push("  );");
out.push("})(window);");

fs.writeFileSync(path.join(__dirname, "frontend", "mahjong-engine.bundle.js"), out.join("\n"));
console.log("bundle written:", path.join(__dirname, "frontend", "mahjong-engine.bundle.js"));
