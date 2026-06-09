// ── 灰燼行動名單 grayOps（每家公司一份文件）──────────────────────────────────────

import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import type { GrayOpsRoster, GrayOpsMechEntry } from '../../types'
import { fetchDocument } from './firestoreCore'
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
      setDoc(doc(db, 'grayOps', company), {
        mechs: mechs.map((m) => (m.version ? m : { name: m.name })),
        updatedAt: serverTimestamp(),
      })
    )
  )
  return bumpDataVersion('grayOpsRoster').catch(() => '')
}
