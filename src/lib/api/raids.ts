// ── 武裝討伐（PLAN-064）────────────────────────────────────────────────────────
//
// 三個公開集合（前台經 Worker 整包讀、走版本 gate 快取）：
//   raidSeasons  一期一份（'raid-21'）
//   stages       一個關卡組一份（'raid-21-g1'），沿用 PLAN-019 Layer 3 的集合名，category '討伐'
//   bosses       一位首領一份（'raid-21-g1-b1'），依難度存面板與技能
// 兩個後台限定集合（只開規則給 ADMIN，不進 Worker／GameDataContext）：
//   raidDrafts   匯入草稿（scripts/import-raid-dungeons.mjs --write 寫入）
//   raidTerms    譯名對照表分片（後台校對頁寫入；匯入腳本讀）
//
// ⚠ 三個公開集合刻意**不進 entityRefs SPECS**、不走 saveWithHistory：
//   文件一律由匯入腳本產生、後台按「發布」整批覆寫，人工資料只存在 raidTerms——
//   沒有級聯要跑，也不需要逐筆稽核（重跑匯入就能重生，見 data retention 的「能否再生」判準）。
//   進 SPECS 會讓級聯刪除與引用掃描自動連帶讀這些集合，rules 晚一步部署時全站刪除會一起 permission-denied。

import { collection, doc, getDocs, query, where, writeBatch, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { Boss, RaidDraft, RaidSeason, RaidTermDoc, RaidTermEntry, Stage } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'
import { applyTermOverrides, termHash, type TermOverrideResult } from '../../utils/raidDraft'

// ── 前台（GameDataContext 經 Worker 讀；這三支是 dev 直連／後台用）──
export const getRaidSeasons = () => fetchCollection<RaidSeason>('raidSeasons')
export const getStages = () => fetchCollection<Stage>('stages')
export const getBosses = () => fetchCollection<Boss>('bosses')

// ── 後台：草稿與對照表 ──
export const getRaidDrafts = () => fetchCollection<RaidDraft>('raidDrafts')
export const getRaidTerms = () => fetchCollection<RaidTermDoc>('raidTerms')

/**
 * 寫一筆譯名（站長在校對頁填的）。merge 寫入該種類的分片，只動這一條。
 * 鍵用 termHash(原文)，與匯入端一致。
 */
export async function saveRaidTerm(kind: string, cn: string, tw: string, by: string, opts: { status?: RaidTermEntry['status']; source?: string; firstSeason?: number } = {}): Promise<RaidTermEntry> {
  const entry: RaidTermEntry = stripUndefined({
    cn, tw, status: opts.status ?? 'verified', source: opts.source ?? 'manual',
    firstSeason: opts.firstSeason, updatedAt: new Date().toISOString(), updatedBy: by,
  })
  const key = await termHash(cn)
  await setDoc(doc(db, 'raidTerms', kind), { kind, entries: { [key]: entry } }, { merge: true })
  return entry
}

/** 發布結果（給審核頁顯示） */
export interface PublishResult extends TermOverrideResult {
  written: number
  deleted: string[]
}

/**
 * 發布一期（D-4）：草稿套上已校譯名 → 一個 batch 寫入 raidSeasons／stages／bosses，
 * 刪掉這一期已發布、但草稿裡已經沒有的關卡與首領 → bump 三個集合 → 在草稿記一筆發布摘要。
 * published＝公開開關（false＝寫入但前台不列出，D-3）。
 */
export async function publishRaidDraft(draft: RaidDraft, terms: Map<string, RaidTermEntry>, by: string, published: boolean): Promise<PublishResult> {
  const r = applyTermOverrides(draft, terms)
  const now = new Date().toISOString()
  const sid = draft.season.id
  const [oldStages, oldBosses] = await Promise.all([
    getDocs(query(collection(db, 'stages'), where('raid.seasonId', '==', sid))),
    getDocs(query(collection(db, 'bosses'), where('seasonId', '==', sid))),
  ])
  const keepStages = new Set(r.stages.map((s) => s.id))
  const keepBosses = new Set(r.bosses.map((b) => b.id))
  const deleted = [
    ...oldStages.docs.filter((d) => !keepStages.has(d.id)).map((d) => `stages/${d.id}`),
    ...oldBosses.docs.filter((d) => !keepBosses.has(d.id)).map((d) => `bosses/${d.id}`),
  ]

  const batch = writeBatch(db)
  const put = <T extends { id: string }>(coll: string, data: T) => {
    const { id, ...rest } = data
    batch.set(doc(db, coll, id), stripUndefined({ ...rest, updatedAt: now, updatedBy: by }))
  }
  put('raidSeasons', { ...r.season, published })
  for (const s of r.stages) put('stages', s)
  for (const b of r.bosses) put('bosses', b)
  for (const path of deleted) {
    const [coll, id] = path.split('/')
    batch.delete(doc(db, coll, id))
  }
  await batch.commit()
  await Promise.all(['raidSeasons', 'stages', 'bosses'].map((k) => bumpDataVersion(k).catch(() => '')))
  await updateDoc(doc(db, 'raidDrafts', draft.id), {
    lastPublished: { at: now, by, parserVersion: draft.parserVersion, sourceBuild: draft.sourceBuild, stages: r.stages.length, bosses: r.bosses.length },
  })
  return { ...r, written: 1 + r.stages.length + r.bosses.length, deleted }
}

/** 公開開關（已發布的期：只改旗標，不重寫內容） */
export async function setRaidSeasonPublished(id: string, published: boolean, by: string): Promise<void> {
  await updateDoc(doc(db, 'raidSeasons', id), { published, updatedAt: new Date().toISOString(), updatedBy: by })
  await bumpDataVersion('raidSeasons').catch(() => '')
}
