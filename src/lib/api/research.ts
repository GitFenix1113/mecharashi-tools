// ── 科研 research（PLAN：機師個別科研 + 全域科研，皆唯讀）──────────────────────

import { where } from 'firebase/firestore'
import type { PilotResearch, GlobalResearch } from '../../types'
import { fetchCollection, fetchDocument } from './firestoreCore'

export const getPilotResearch = (pilotId: string) =>
  fetchCollection<PilotResearch>('pilotResearch', [where('pilotId', '==', pilotId)])

export const getAllPilotResearch = () =>
  fetchCollection<PilotResearch>('pilotResearch')

export const getGlobalResearch = async (): Promise<GlobalResearch | null> =>
  fetchDocument<GlobalResearch>('globalResearch', 'global')
