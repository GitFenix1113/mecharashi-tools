/**
 * 米赫瑪超吉情豹站 — 上傳副模組到 Firestore
 *
 * 將 10 種通用副模組（sub_mod_* 命名）寫入 modules 集合。
 *
 * 使用方式：
 *   node scripts/upload-sub-modules.mjs            ← dry-run，只列出資料不寫入
 *   node scripts/upload-sub-modules.mjs --confirm  ← 實際寫入
 */

import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIRM = process.argv.includes('--confirm');
const KEY_PATH = join(__dirname, '../serviceAccountKey.json');

// ── 副模組資料（來源：modules.csv）────────────────────────────────────────────
// stat 欄位說明：
//   dmg          = 火力值提升%
//   critDmg      = 暴擊傷害提升%
//   acc          = 命中率提升%
//   crit         = 暴擊率提升%
//   durable      = 耐久值提升%
//   armorBonus   = 護甲值提升%
//   defenseBonus = 遭受傷害降低%
//   evasion      = 回避率提升%
//   antiCrit     = 被暴擊率降低%
//   outputBonus  = 機甲整體出力增加（絕對值）

const SUB_MODULES = [
  {
    id: 'sub_mod_火力模組',
    name: '火力模組',
    statField: 'dmg',
    levels: [
      { level: 1, value: 3,  description: '火力值提升3%'   },
      { level: 2, value: 5,  description: '火力值提升5%'   },
      { level: 3, value: 7,  description: '火力值提升7%'   },
      { level: 4, value: 10, description: '火力值提升10%'  },
    ],
  },
  {
    id: 'sub_mod_增傷模組',
    name: '增傷模組',
    statField: 'critDmg',
    levels: [
      { level: 1, value: 3,  description: '暴擊傷害提升3%'   },
      { level: 2, value: 5,  description: '暴擊傷害提升5%'   },
      { level: 3, value: 7,  description: '暴擊傷害提升7%'   },
      { level: 4, value: 10, description: '暴擊傷害提升10%'  },
    ],
  },
  {
    id: 'sub_mod_校準模組',
    name: '校準模組',
    statField: 'acc',
    levels: [
      { level: 1, value: 3,  description: '命中率提升3%'   },
      { level: 2, value: 5,  description: '命中率提升5%'   },
      { level: 3, value: 7,  description: '命中率提升7%'   },
      { level: 4, value: 10, description: '命中率提升10%'  },
    ],
  },
  {
    id: 'sub_mod_暴擊模組',
    name: '暴擊模組',
    statField: 'crit',
    levels: [
      { level: 1, value: 3,  description: '暴擊率提升3%'   },
      { level: 2, value: 5,  description: '暴擊率提升5%'   },
      { level: 3, value: 7,  description: '暴擊率提升7%'   },
      { level: 4, value: 10, description: '暴擊率提升10%'  },
    ],
  },
  {
    id: 'sub_mod_耐久模組',
    name: '耐久模組',
    statField: 'durable',
    levels: [
      { level: 1, value: 3,  description: '耐久值提升3%'   },
      { level: 2, value: 5,  description: '耐久值提升5%'   },
      { level: 3, value: 7,  description: '耐久值提升7%'   },
      { level: 4, value: 10, description: '耐久值提升10%'  },
    ],
  },
  {
    id: 'sub_mod_護甲模組',
    name: '護甲模組',
    statField: 'armorBonus',
    levels: [
      { level: 1, value: 10, description: '護甲值提升10%'  },
      { level: 2, value: 17, description: '護甲值提升17%'  },
      { level: 3, value: 25, description: '護甲值提升25%'  },
      { level: 4, value: 35, description: '護甲值提升35%'  },
    ],
  },
  {
    id: 'sub_mod_承傷模組',
    name: '承傷模組',
    statField: 'defenseBonus',
    levels: [
      { level: 1, value: 3,  description: '遭受傷害降低3%'   },
      { level: 2, value: 5,  description: '遭受傷害降低5%'   },
      { level: 3, value: 7,  description: '遭受傷害降低7%'   },
      { level: 4, value: 10, description: '遭受傷害降低10%'  },
    ],
  },
  {
    id: 'sub_mod_回避模組',
    name: '回避模組',
    statField: 'evasion',
    levels: [
      { level: 1, value: 3,  description: '回避率提升3%'   },
      { level: 2, value: 5,  description: '回避率提升5%'   },
      { level: 3, value: 7,  description: '回避率提升7%'   },
      { level: 4, value: 10, description: '回避率提升10%'  },
    ],
  },
  {
    id: 'sub_mod_防爆模組',
    name: '防爆模組',
    statField: 'antiCrit',
    levels: [
      { level: 1, value: 3,  description: '被暴擊率降低3%'   },
      { level: 2, value: 5,  description: '被暴擊率降低5%'   },
      { level: 3, value: 7,  description: '被暴擊率降低7%'   },
      { level: 4, value: 10, description: '被暴擊率降低10%'  },
    ],
  },
  {
    id: 'sub_mod_出力模組',
    name: '出力模組',
    statField: 'outputBonus',
    levels: [
      { level: 1, value: 25,  description: '機甲整體出力增加25'   },
      { level: 2, value: 50,  description: '機甲整體出力增加50'   },
      { level: 3, value: 75,  description: '機甲整體出力增加75'   },
      { level: 4, value: 100, description: '機甲整體出力增加100'  },
    ],
  },
];

// ── 將內部定義轉成 Firestore 文件格式 ─────────────────────────────────────────
function buildDocument(mod) {
  const maxLevel = mod.levels[mod.levels.length - 1];

  // 各 stat 欄位預設 0，再填入對應欄位的 MAX 值
  const baseStats = {
    dmg: 0, crit: 0, critDmg: 0, acc: 0,
    durable: 0, armorBonus: 0, defenseBonus: 0, evasion: 0, antiCrit: 0,
    outputBonus: 0,
  };
  baseStats[mod.statField] = maxLevel.value;

  const levels = mod.levels.map(lv => {
    const lvStats = {
      dmg: 0, crit: 0, critDmg: 0, acc: 0,
      durable: 0, armorBonus: 0, defenseBonus: 0, evasion: 0, antiCrit: 0,
      outputBonus: 0,
    };
    lvStats[mod.statField] = lv.value;
    return {
      level: lv.level,
      description: lv.description,
      ...lvStats,
    };
  });

  return {
    id:          mod.id,
    name:        mod.name,
    slot:        '機甲副模組',
    boundMechId: null,
    boundPart:   null,
    available:   true,
    source:      '未知',
    managedBy:   'manual',
    ...baseStats,
    levels,
    description: maxLevel.description,
    rarity:      '',
    icon:        '',
  };
}

// ── 主流程 ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║  米赫瑪超吉情豹站 — 副模組上傳腳本  ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`  模式: ${CONFIRM ? '實際寫入' : 'Dry-run（僅列出，不寫入）'}`);
  console.log('');

  const docs = SUB_MODULES.map(buildDocument);

  console.log(`要寫入的文件（共 ${docs.length} 筆）：`);
  docs.forEach(d => {
    const maxStat = Object.entries(d)
      .filter(([k]) => ['dmg','crit','critDmg','acc','durable','armorBonus','defenseBonus','evasion','antiCrit','outputBonus'].includes(k))
      .find(([, v]) => v !== 0);
    const statStr = maxStat ? `${maxStat[0]}=${maxStat[1]}` : '-';
    console.log(`  + ${d.id}  (${d.name})  MAX: ${statStr}`);
  });

  if (!CONFIRM) {
    console.log('\n⚠ 這是 dry-run，未實際寫入。加上 --confirm 才執行。');
    console.log('');
    process.exit(0);
  }

  const serviceAccount = JSON.parse(readFileSync(KEY_PATH, 'utf-8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  console.log('\n寫入中...');
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach(d => {
      const ref = db.collection('modules').doc(d.id);
      batch.set(ref, d, { merge: true });
    });
    await batch.commit();
  }
  console.log(`✅ 已寫入 ${docs.length} 筆副模組到 Firestore。`);
  console.log('');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ 執行失敗：', err.message);
  process.exit(1);
});
