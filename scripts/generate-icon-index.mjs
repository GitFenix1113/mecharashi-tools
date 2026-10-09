/**
 * 圖示圖庫索引產生器（PLAN-055 A-4）—— 掃 public/images/game/icons/ 產出 icons/index.json
 *
 * 給誰用：只有後台的 GameIconPicker（開啟時才 lazy fetch，不進前台 bundle）。
 * 前台顯示**不需要**這份索引：key → 路徑是確定的（src/utils/gameIcons.ts 的 gameIconPath）。
 *
 * 只存檔名，不存解析結果：種類／色系／編號都由選圖器用 parseIconKey() 從檔名解析
 * （同一套規則有 Node 版 scripts/lib/gameIconKinds.mjs 與 TS 版 src/utils/gameIcons.ts，測試交叉比對），
 * 存兩份只會多一個會跟檔名脫節的地方。
 *
 *   {
 *     "skill":  ["Icon_entry_10001", "Icon_skill_main_1001", ...],
 *     "buff":   ["Icon_buff_1001", "Icon_debuff_active", ...],
 *     "legacy": ["Icon_skill_main_1045", ...],  // 現行客戶端已沒有的舊版官方圖（選圖器預設收起）
 *     "weapon": ["Icon_weapon_10100101", ...],  // PLAN-056
 *     "backpack": ["Icon_BackPack_60350101", ...],
 *     "notes": { "Icon_weapon_10601301": "空手（不裝武器）", ... }   // 站長確認過的觀察（scripts/lib/equipIconNotes.json）
 *   }
 *
 * legacy 清單無法從檔案本身推導（要跟客戶端擷取比對過才知道），由匯入腳本寫在 scripts/lib/gameIconMeta.json。
 *
 * 使用：node scripts/generate-icon-index.mjs（已接進 package.json 的 build / predev）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { ICON_DIR, ICON_FEATURE_DIM, iconFeature, isLibraryKey } from './lib/gameIconKinds.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR = path.join(ROOT, 'public', ICON_DIR)
const META = path.join(ROOT, 'scripts/lib/gameIconMeta.json')
const NOTES = path.join(ROOT, 'scripts/lib/equipIconNotes.json')
const OUT = path.join(DIR, 'index.json')

if (!fs.existsSync(DIR)) {
  console.log(`⏭  沒有圖示圖庫（${path.relative(ROOT, DIR)}），略過`)
  process.exit(0)
}

const list = (family) => {
  const d = path.join(DIR, family)
  if (!fs.existsSync(d)) return []
  const keys = fs.readdirSync(d).filter((f) => f.endsWith('.webp')).map((f) => f.slice(0, -5))
  const bad = keys.filter((k) => !isLibraryKey(k))
  if (bad.length) {
    console.error(`❌ ${family}/ 裡有不符合官方命名規則的檔案：${bad.join('、')}`)
    process.exit(1)
  }
  return keys.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
}

const skill = list('skill')
const buff = list('buff')
const weapon = list('weapon')
const backpack = list('backpack')
const meta = fs.existsSync(META) ? JSON.parse(fs.readFileSync(META, 'utf-8')) : { legacy: [] }
const have = new Set(skill)
const legacy = (meta.legacy ?? []).filter((k) => have.has(k))

// ── 以圖搜圖的特徵（PLAN-055 B-4）──────────────────────────────────────────────
// 每張圖：原尺寸 RGBA → iconFeature（裁到不透明外框、12×12 區塊墊黑平均）＝432 bytes，依 [...skill, ...buff, ...weapon, ...backpack] 串成一個 .bin。
// 選圖器只在按下「以圖搜圖」時才下載（約 660 KB）。檔案清單與演算法版本都沒變就不重算（build／predev 每次都會跑這支）。
const FEATURE_VERSION = 2
const FEATURE_BIN = path.join(DIR, 'features.bin')
const order = [...skill.map((k) => ['skill', k]), ...buff.map((k) => ['buff', k]), ...weapon.map((k) => ['weapon', k]), ...backpack.map((k) => ['backpack', k])]
const orderHash = crypto.createHash('sha1').update([`v${FEATURE_VERSION}`, ...order.map(([, k]) => k)].join('|')).digest('hex').slice(0, 12)
const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf-8')) : null
if (!(prev?.features?.hash === orderHash && fs.existsSync(FEATURE_BIN))) {
  const { default: sharp } = await import('sharp')
  const per = ICON_FEATURE_DIM * ICON_FEATURE_DIM * 3
  const bin = Buffer.alloc(order.length * per)
  for (let n = 0; n < order.length; n++) {
    const [family, key] = order[n]
    const { data, info } = await sharp(path.join(DIR, family, `${key}.webp`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    bin.set(iconFeature(data, info.width, info.height), n * per)
  }
  fs.writeFileSync(FEATURE_BIN, bin)
  console.log(`   以圖搜圖特徵已更新：${path.relative(ROOT, FEATURE_BIN)}（${(bin.length / 1024).toFixed(0)} KB）`)
}

// 站長確認過的圖示註記（PLAN-056）：只留圖庫裡真的有的 key
const allKeys = new Set([...skill, ...buff, ...weapon, ...backpack])
const notesRaw = fs.existsSync(NOTES) ? JSON.parse(fs.readFileSync(NOTES, 'utf-8')).notes ?? {} : {}
const notes = Object.fromEntries(Object.entries(notesRaw).filter(([k]) => allKeys.has(k)))

fs.writeFileSync(OUT, JSON.stringify({ skill, buff, weapon, backpack, legacy, notes, features: { dim: ICON_FEATURE_DIM, hash: orderHash } }))
console.log(`✅ 圖示索引已產生：${path.relative(ROOT, OUT)}（技能類 ${skill.length}、BUFF ${buff.length}、武器 ${weapon.length}、背包 ${backpack.length}、舊版 ${legacy.length}、註記 ${Object.keys(notes).length}）`)
