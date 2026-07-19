// ── BUFF buffs（PLAN-019 Layer 2）：BUFF / 狀態 / 形態定義庫 ─────────────────────

import type { GameBuff } from '../../types'
import { fetchCollection } from './firestoreCore'
import { saveWithHistory } from './changeHistory'

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
