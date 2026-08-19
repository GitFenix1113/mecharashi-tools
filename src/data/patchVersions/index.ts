export type { ArmamentRaid, BattlePass, PatchHalf, GrayOpsUpdate, GrayOpsCompany, PatchVersion, VersionIconUrls, VersionEntityIds, TimedActivity, ActivityType } from './types'
export { parseEntityIdValue, formatEntityIdValue } from './entityRef'
export { normalizeNotes } from './notes'
export { GRAY_OPS_BASE } from './base'

import type { PatchVersion } from './types'
import v2_8 from './v2.8'
import v3_0 from './v3.0'
import v3_1 from './v3.1'
import v3_2 from './v3.2'
import v3_3 from './v3.3'

// ── 空白歷史版本佔位（1.0–2.7）─────────────────────────────────────────────
// 早期版本尚無完整資料，先建空白骨架：讓「登場版本」下拉能選到全部版本、
// 並在首頁時間軸／版本列表以「日期未定・暫無資料」佔位呈現（歷史博物館雛形）。
// 版本號有跳號：無 1.9、無 2.9（依官方版本序，2.8 直接進 3.0）。
// 回填方式：把對應的 blank('x') 換成獨立版本檔（比照 v2.8.ts）並改為 import 即可。
const blank = (version: string): PatchVersion => ({
  version,
  upper: { cnDate: '' },
  lower: { cnDate: '' },
})

const HISTORICAL_BLANKS: PatchVersion[] = [
  '1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8',
  '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7',
].map(blank)

// 依版本號升序：歷史空白在前，已建檔版本（2.8+）在後
export const PATCH_VERSIONS = [...HISTORICAL_BLANKS, v2_8, v3_0, v3_1, v3_2, v3_3]
