// 陸版遊戲參數資料包：找最新一包、開唯讀 SQLite、讀記錄與文字。
//
// 找法與 scripts/lib/raid_db.py 的 latest_package()、import-raid-dungeons.mjs 的 latestPackage() 同一套，改一邊要一起改：
//   遊戲參數資料包_<日期>\遊戲資料.sqlite 與 改版調查_<日期>\資料\遊戲資料.sqlite 都算；
//   取日期最新的，同一天兩種都有時完整交付包優先。
// 資料包是唯讀的：一律 readOnly 開啟，不寫任何東西回去。

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const DATA_ROOT = 'E:/Mecharashi_Data'

/** 最新資料包：{ label: 資料夾名, dir: 遊戲資料.sqlite 所在資料夾 }；找不到回 null */
export function latestGamePackage(root = DATA_ROOT) {
  if (!fs.existsSync(root)) return null
  const cands = []
  for (const d of fs.readdirSync(root)) {
    if (d.startsWith('遊戲參數資料包_') && fs.existsSync(path.join(root, d, '遊戲資料.sqlite'))) cands.push({ label: d, full: 1, dir: path.join(root, d) })
    else if (d.startsWith('改版調查_') && fs.existsSync(path.join(root, d, '資料', '遊戲資料.sqlite'))) cands.push({ label: d, full: 0, dir: path.join(root, d, '資料') })
  }
  const date = (label) => /_(\d{8})$/.exec(label)?.[1] ?? ''
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
  cands.sort((a, b) => cmp(date(a.label), date(b.label)) || a.full - b.full || cmp(a.label, b.label))
  const last = cands.at(-1)
  return last ? { label: last.label, dir: last.dir } : null
}

/**
 * 開資料包。回傳：
 *   rec(table, id)  → 該表該 ID 的記錄（JSON），沒有回 null
 *   text(key)       → 文字表（簡中），key 可帶 'ST:' 前綴
 *   fx(v)           → 定點數 { RawValue } 轉成一般數字（2^32 為 1）
 */
export function openGamePackage(pkg) {
  const sql = new DatabaseSync(path.join(pkg.dir, '遊戲資料.sqlite'), { readOnly: true })
  const recQ = sql.prepare('SELECT json FROM records WHERE table_name=? AND id=?')
  const txtQ = sql.prepare('SELECT value FROM texts WHERE id=?')
  return {
    rec: (table, id) => { if (id == null || id === '') return null; const r = recQ.get(table, String(id)); return r ? JSON.parse(r.json) : null },
    text: (key) => { if (!key) return ''; const r = txtQ.get(String(key).replace('ST:', '')); return r ? r.value : '' },
    fx: (v) => (v && typeof v === 'object' && 'RawValue' in v ? Number(BigInt(v.RawValue)) / 2 ** 32 : v),
    close: () => sql.close(),
  }
}
