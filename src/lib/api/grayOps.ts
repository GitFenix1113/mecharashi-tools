// ── 灰燼行動名單 grayOps（每家公司一份文件）──────────────────────────────────────

import { collection, getDocs, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import type { GrayOpsRoster, GrayOpsMechEntry } from '../../types'
import { fetchDocument, stripUndefined, writeDocRaw } from './firestoreCore'
import { bumpDataVersion } from './versions'

export const getGrayOpsRoster = async (): Promise<GrayOpsRoster | null> => {
  const snap = await getDocs(collection(db, 'grayOps'))
  if (snap.empty) return null
  const companies: Record<string, GrayOpsMechEntry[]> = {}
  for (const d of snap.docs) {
    if (d.id === 'roster') continue
    const data = d.data()
    if (Array.isArray(data.mechs)) companies[d.id] = data.mechs as GrayOpsMechEntry[]
  }
  if (Object.keys(companies).length === 0) {
    // 舊格式 fallback
    return fetchDocument<GrayOpsRoster>('grayOps', 'roster')
  }
  return { companies }
}

export const updateGrayOpsRoster = async (roster: GrayOpsRoster): Promise<string> => {
  await Promise.all(
    Object.entries(roster.companies).map(([company, mechs]) =>
      // writeDocRaw（不是 writeDoc）：payload 含 serverTimestamp() 哨兵值，
      // 整包 stripUndefined 會把它遞迴拆成普通物件而失效。故只對 mechs 做 strip。
      writeDocRaw('grayOps', company, {
        // 原本是 `m.version ? m : { name: m.name }`——那是為了避開 Firestore 拒收 undefined，
        // 但它同時把「白名單以外的欄位」整個丟掉：icon / mechId 加進來後會在存檔時靜默蒸發。
        // 改用共用的 stripUndefined，只清 undefined、不挑欄位，日後再加欄位也不必回來改這裡。
        mechs: stripUndefined(mechs),
        updatedAt: serverTimestamp(),
      })
    )
  )
  return bumpDataVersion('grayOpsRoster').catch(() => '')
}
