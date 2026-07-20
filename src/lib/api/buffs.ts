// ── BUFF buffs（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 ─────────────────────

import type { GameBuff } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'
import { cascadeDelete, type CascadeDeleteResult } from './cascadeDelete'

/** buffs Collection（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 */
export const getBuffs = () =>
  fetchCollection<GameBuff>('buffs')

/**
 * PLAN-019-F：BUFF 後台寫入（buffs 安全規則已具備 admin write）。
 * PLAN-030：改走 saveWithHistory —— 寫入前讀一次 pre-image 以區分 create/update
 * 並記錄變更歷史。簽章與回傳值（版本字串）維持不變，呼叫端無感。
 */
export const updateBuff = (buff: GameBuff): Promise<string> =>
  saveWithHistory('buff', buff)

/**
 * PLAN-030 C-5：刪除 BUFF 並級聯清除全站對它的引用。
 *
 * 一次做完（掃描 → 建計畫 → 安全閘 → 寫 log → 原子提交）。**已不存在時回傳 `null`**，
 * 不寫 log 也不報錯——重複點擊或他人已先刪掉都走這條，不該視為失敗。
 *
 * 後台 UI 應改用 `planCascadeDelete('buff', id)` ＋ `commitCascadeDelete()` 兩段式，
 * 讓確認對話框先顯示影響範圍；本函式是給腳本與測試的便利入口。
 *
 * 回傳值含 `versions` 與 `targetCollHasSiblingEdits`，呼叫端據此同步自己的快取——
 * **後者為 `true` 時不可只用 `removeCollectionItem`**（同集合有兄弟文件被改寫，
 * 就地移除會把未同步的舊內容連同新版本號寫進 localStorage 而永不自癒）。
 */
export const deleteBuff = (id: string): Promise<CascadeDeleteResult | null> =>
  cascadeDelete('buff', id)
