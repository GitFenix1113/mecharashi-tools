// ── 詞條庫 glossaryTerms（PLAN-019-C）：refType:'term' 的資料源 ────────────────────

import { doc, setDoc } from 'firebase/firestore'
import { db } from '../firebase'
import type { GlossaryTerm } from '../../types'
import { fetchCollection, stripUndefined } from './firestoreCore'
import { bumpDataVersion } from './versions'

/** glossaryTerms Collection（PLAN-019-C 詞條庫）：無專屬集合的機制關鍵字，refType:'term' 的資料源 */
export const getGlossaryTerms = () =>
  fetchCollection<GlossaryTerm>('glossaryTerms')

/** PLAN-019-C：寫入/更新單一詞條文件（refType:'term' 的單一資料源） */
export const updateGlossaryTerm = async (term: GlossaryTerm): Promise<string> => {
  const { id, ...data } = term
  await setDoc(doc(db, 'glossaryTerms', id), stripUndefined(data))
  return bumpDataVersion('glossaryTerms').catch(() => '')
}
