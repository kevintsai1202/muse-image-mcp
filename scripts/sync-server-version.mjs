/**
 * 把 package.json 的版本同步到 server.json。
 *
 * 為什麼需要：版本號散在三個地方——package.json 的 version、server.json 的 version、
 * 以及 server.json 裡 packages[0].version（指向 npm 上的哪一版）。手動維護遲早漏改，
 * 而漏改的後果是 Registry 指向不存在或過舊的 npm 版本。
 *
 * 這支腳本掛在 npm 的 version lifecycle 上（package.json 的 scripts.version），
 * 所以 `npm version patch` 會自動帶著跑，不需要記得另外執行。
 * publish workflow 另有一道一致性檢查當防呆，兩者互相補位。
 *
 * 用法：node scripts/sync-server-version.mjs        # 同步
 *       node scripts/sync-server-version.mjs --check # 只檢查，不一致則以非零碼結束
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
const serverPath = resolve(ROOT, "server.json");
const server = JSON.parse(readFileSync(serverPath, "utf8"));

const target = pkg.version;
const found = { "server.json version": server.version };
server.packages?.forEach((p, i) => {
  found[`server.json packages[${i}].version`] = p.version;
});

const mismatches = Object.entries(found).filter(([, v]) => v !== target);

if (checkOnly) {
  if (mismatches.length > 0) {
    console.error(`版本不一致，package.json 為 ${target}：`);
    mismatches.forEach(([k, v]) => console.error(`  ${k} = ${v}`));
    console.error("請執行 node scripts/sync-server-version.mjs 後重新提交");
    process.exit(1);
  }
  console.log(`版本一致：${target}`);
  process.exit(0);
}

// mcpName 與 server.json 的 name 必須相同，否則 Registry 會拒絕發佈；
// 順手在同步時檢查，比發佈當下才失敗早得多
if (pkg.mcpName !== server.name) {
  console.error(`package.json 的 mcpName (${pkg.mcpName}) 與 server.json 的 name (${server.name}) 不一致`);
  process.exit(1);
}

if (mismatches.length === 0) {
  console.log(`server.json 已是 ${target}，無需變更`);
  process.exit(0);
}

server.version = target;
server.packages?.forEach(p => { p.version = target; });
writeFileSync(serverPath, JSON.stringify(server, null, 2) + "\n");
console.log(`server.json 已同步為 ${target}`);
