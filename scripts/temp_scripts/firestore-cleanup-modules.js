/**
 * 米赫瑪超吉情豹站 — Firestore 模組清理腳本
 *
 * 刪除 Firestore modules 集合中，ID 含 _4mod / _8mod / _fixed 的舊機甲副模組條目。
 * 可選加上 --sync 將 public/data/modules.json 一併 upsert 到 Firestore。
 *
 * 使用方式：
 *   node scripts/firestore-cleanup-modules.js             ← 列出要刪的清單（dry-run）
 *   node scripts/firestore-cleanup-modules.js --confirm   ← 實際刪除
 *   node scripts/firestore-cleanup-modules.js --confirm --sync ← 刪除後同步 JSON
 */

import admin from 'firebase-admin';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRM   = process.argv.includes('--confirm');
const SYNC      = process.argv.includes('--sync');

const KEY_PATH  = join(__dirname, '../serviceAccountKey.json');
const JSON_PATH = join(__dirname, '../public/data/modules.json');

// ── 初始化 Firebase Admin ────────────────────────────────────────────────────
const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── 判斷是否為舊機甲副模組 ID ────────────────────────────────────────────────
function isMechSubModule(id) {
  return /_(4mod|8mod|fixed)/.test(id);
}

// ── 批次刪除（每批最多 500）────────────────────────────────────────────────────
async function batchDelete(docs) {
  let deleted = 0;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(500, docs.length - i);
  }
  return deleted;
}

// ── 批次 Upsert（每批最多 500）───────────────────────────────────────────────
async function batchUpsert(modules) {
  let upserted = 0;
  for (let i = 0; i < modules.length; i += 500) {
    const batch = db.batch();
    modules.slice(i, i + 500).forEach(m => {
      const ref = db.collection('modules').doc(m.id);
      batch.set(ref, m, { merge: true });
    });
    await batch.commit();
    upserted += Math.min(500, modules.length - i);
    process.stdout.write(`  upsert ${upserted}/${modules.length}...\r`);
  }
  process.stdout.write('\n');
  return upserted;
}

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  米赫瑪超吉情豹站 — Firestore 模組清理腳本  ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log(`  模式: ${CONFIRM ? '實際執行' : 'Dry-run（僅列出，不刪除）'}  同步JSON: ${SYNC ? '✓' : '✗'}`);
  console.log('');

  // ── 讀取 Firestore 模組清單 ──
  console.log('讀取 Firestore modules 集合...');
  const snap = await db.collection('modules').get();
  const allDocs = snap.docs;
  console.log(`  → 共 ${allDocs.length} 筆文件`);

  const toDelete = allDocs.filter(d => isMechSubModule(d.id));
  console.log(`  → 符合刪除條件（_4mod/_8mod/_fixed）: ${toDelete.length} 筆`);

  if (toDelete.length === 0) {
    console.log('\n✅ 無需清理，Firestore 已乾淨。');
  } else {
    console.log('\n要刪除的文件：');
    toDelete.forEach(d => {
      const data = d.data();
      console.log(`  - ${d.id}  (${data.name || ''})`);
    });

    if (!CONFIRM) {
      console.log('\n⚠ 這是 dry-run，未實際刪除。加上 --confirm 才執行刪除。');
    } else {
      console.log('\n刪除中...');
      const deleted = await batchDelete(toDelete);
      console.log(`✅ 已刪除 ${deleted} 筆機甲副模組。`);
    }
  }

  // ── 同步 JSON → Firestore ──
  if (SYNC) {
    if (!existsSync(JSON_PATH)) {
      console.log(`\n⚠ 找不到 ${JSON_PATH}，略過同步。`);
    } else {
      const localModules = JSON.parse(readFileSync(JSON_PATH, 'utf-8'));
      console.log(`\n同步 modules.json（${localModules.length} 筆）到 Firestore...`);

      if (!CONFIRM) {
        console.log('  ⚠ dry-run 模式，略過實際 upsert。加上 --confirm 才執行。');
      } else {
        const count = await batchUpsert(localModules);
        console.log(`✅ 已 upsert ${count} 筆模組到 Firestore。`);
      }
    }
  }

  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ 執行失敗：', err.message);
  process.exit(1);
});
