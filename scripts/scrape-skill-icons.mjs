/**
 * 米赫瑪超吉情豹站 — 技能圖示「暴力枚舉」擷取腳本
 *
 * 官方把技能圖示放在同一個 CDN 目錄底下，檔名是固定前綴 + 4 位數字編碼。
 * 機師管線（scrape-pilots-v3.js）只會下載「目前有機師用到」的那些 icon，
 * 但官方其實放了更多沒被引用到的圖。本腳本針對每種前綴，從 0000 試到 9999，
 * 只要 CDN 回傳真正的圖片就下載下來。
 *
 * ── icon 命名 ─────────────────────────────────────────────────
 *   Icon_skill_main_####     主動技能
 *   Icon_skill_order_####    指令技能
 *   Icon_skill_passive_####  被動技能
 *   Icon_skill_talent_####   天賦/被動技能
 *
 * ── 來源與存檔 ────────────────────────────────────────────────
 *   來源：{IMG_BASE}/skill/{iconKey}.png
 *   存檔：public/images/skills/{iconKey}.png
 *
 * ── 偵測邏輯 ──────────────────────────────────────────────────
 *   CDN 對「已快取的存在檔」直接回 200 image/png；
 *   對「未快取」回 302 轉址到 origin，origin 再回 200(存在) 或 404(不存在)。
 *   因此本腳本會跟隨轉址，並以「最終 200 + content-type 為 image」判定存在。
 *
 * ── 使用方式 ──────────────────────────────────────────────────
 *   node scripts/scrape-skill-icons.mjs                       ← 四種前綴全跑 0000-9999
 *   node scripts/scrape-skill-icons.mjs --prefix=main,order   ← 只跑指定前綴
 *   node scripts/scrape-skill-icons.mjs --from=1000 --to=2000 ← 限定編碼範圍
 *   node scripts/scrape-skill-icons.mjs --concurrency=40      ← 調整並發數（預設 30）
 *   node scripts/scrape-skill-icons.mjs --force               ← 已存在的檔也重抓覆蓋
 *   node scripts/scrape-skill-icons.mjs --dry-run             ← 只偵測不寫檔（報告會找到幾個）
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── 設定 ──────────────────────────────────────────────────────
const IMG_BASE    = 'https://media.zlongame.com/media/pictures/cn/community/img/gl/gameInfo';
const SKILLS_DIR  = path.join(__dirname, '../public/images/skills');
const ALL_PREFIXES = ['main', 'order', 'passive', 'talent'];

// ── 命令列參數 ────────────────────────────────────────────────
const args    = process.argv.slice(2);
const FORCE   = args.includes('--force');
const DRY_RUN = args.includes('--dry-run');

function argVal(name, fallback) {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : fallback;
}

const PREFIXES = (() => {
  const raw = argVal('prefix', '');
  if (!raw) return ALL_PREFIXES;
  const picked = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const bad = picked.filter(p => !ALL_PREFIXES.includes(p));
  if (bad.length) {
    console.error(`❌ 不認得的前綴：${bad.join(', ')}（可用：${ALL_PREFIXES.join(', ')}）`);
    process.exit(1);
  }
  return picked;
})();

const FROM        = Math.max(0, parseInt(argVal('from', '0'), 10) || 0);
const TO          = Math.min(9999, parseInt(argVal('to', '9999'), 10));
const CONCURRENCY = Math.max(1, parseInt(argVal('concurrency', '30'), 10) || 30);

const pad4 = n => String(n).padStart(4, '0');

// ── HTTP：跟隨轉址，回傳「最終是否為圖片」 ─────────────────────
// 解析結果：
//   { status: 'found',     buffer }   最終 200 且 content-type 為 image
//   { status: 'notfound' }            404 或最終非圖片
//   { status: 'error', msg }          網路層錯誤 / 逾時
function probe(url, depth = 0) {
  return new Promise(resolve => {
    if (depth > 5) { resolve({ status: 'error', msg: 'too many redirects' }); return; }
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 15000,
    }, res => {
      const { statusCode, headers } = res;

      // 轉址：CDN → origin
      if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
        res.resume(); // 丟棄 body，釋放 socket
        const loc = headers.location;
        if (!loc) { resolve({ status: 'error', msg: 'redirect without location' }); return; }
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        probe(next, depth + 1).then(resolve);
        return;
      }

      const ctype = headers['content-type'] || '';
      if (statusCode !== 200 || !ctype.startsWith('image')) {
        res.resume(); // 非圖片（含 404 的 text/html）→ 丟棄
        resolve({ status: 'notfound' });
        return;
      }

      // 200 圖片 → 收進記憶體（icon 都很小，<100KB）
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: 'found', buffer: Buffer.concat(chunks) }));
      res.on('error', err => resolve({ status: 'error', msg: err.message }));
    });
    req.on('error', err => resolve({ status: 'error', msg: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'error', msg: 'timeout' }); });
  });
}

// ── 單一候選的處理 ────────────────────────────────────────────
async function handle(iconKey, stats) {
  const dest = path.join(SKILLS_DIR, `${iconKey}.png`);

  if (!FORCE && fs.existsSync(dest)) { stats.existed++; return; }

  let result = await probe(`${IMG_BASE}/skill/${iconKey}.png`);

  // 網路錯誤重試一次
  if (result.status === 'error') {
    result = await probe(`${IMG_BASE}/skill/${iconKey}.png`);
  }

  if (result.status === 'found') {
    stats.found++;
    if (!DRY_RUN) fs.writeFileSync(dest, result.buffer);
    console.log(`  ✓ ${iconKey}.png  (${result.buffer.length} bytes)${DRY_RUN ? ' [dry-run]' : ''}`);
  } else if (result.status === 'error') {
    stats.error++;
    console.log(`  ⚠ ${iconKey}  錯誤：${result.msg}`);
  } else {
    stats.notfound++;
  }
  stats.done++;
}

// ── 並發池 ────────────────────────────────────────────────────
async function runPool(tasks, worker) {
  let idx = 0;
  const runners = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < tasks.length) {
      const my = tasks[idx++];
      await worker(my);
    }
  });
  await Promise.all(runners);
}

// ── 主流程 ────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  技能圖示暴力枚舉擷取                              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`  前綴   : ${PREFIXES.join(', ')}`);
  console.log(`  範圍   : ${pad4(FROM)} ~ ${pad4(TO)}`);
  console.log(`  並發   : ${CONCURRENCY}`);
  console.log(`  模式   : ${DRY_RUN ? 'DRY-RUN（不寫檔）' : '下載'}${FORCE ? ' + FORCE（覆蓋既有）' : ''}`);
  console.log(`  存檔   : ${path.relative(process.cwd(), SKILLS_DIR)}`);
  console.log('');

  const grandStart = Date.now();
  const grand = { found: 0, existed: 0, notfound: 0, error: 0 };

  for (const prefix of PREFIXES) {
    const keys = [];
    for (let n = FROM; n <= TO; n++) keys.push(`Icon_skill_${prefix}_${pad4(n)}`);

    const stats = { found: 0, existed: 0, notfound: 0, error: 0, done: 0 };
    const total = keys.length;
    console.log(`▶ ${prefix}（${total} 個候選）`);

    // 進度列（每 1 秒刷新一次）
    const timer = setInterval(() => {
      const pct = ((stats.done / total) * 100).toFixed(1);
      process.stdout.write(`\r   進度 ${stats.done}/${total} (${pct}%)  找到 ${stats.found}  跳過 ${stats.existed}   `);
    }, 1000);

    await runPool(keys, k => handle(k, stats));

    clearInterval(timer);
    process.stdout.write('\r' + ' '.repeat(70) + '\r');
    console.log(`   完成：找到 ${stats.found}、既有跳過 ${stats.existed}、不存在 ${stats.notfound}、錯誤 ${stats.error}`);
    console.log('');

    grand.found    += stats.found;
    grand.existed  += stats.existed;
    grand.notfound += stats.notfound;
    grand.error    += stats.error;
  }

  const secs = ((Date.now() - grandStart) / 1000).toFixed(0);
  console.log('──────────────────────────────────────────────────');
  console.log(`✅ 全部完成（${secs}s）`);
  console.log(`   新下載 ${grand.found}、既有跳過 ${grand.existed}、不存在 ${grand.notfound}、錯誤 ${grand.error}`);
  if (DRY_RUN) console.log('   （DRY-RUN：實際未寫入任何檔案）');
  if (grand.found > 0 && !DRY_RUN) {
    console.log('');
    console.log('   提示：若前端需要讓新 icon 進入圖片清單，記得重生 manifest：');
    console.log('         npm run manifest:images');
  }
}

main().catch(err => {
  console.error('\n❌ 腳本執行失敗：', err.message);
  console.error(err.stack);
  process.exit(1);
});
