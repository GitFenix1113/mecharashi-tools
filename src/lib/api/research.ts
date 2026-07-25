// ── 科研 research（PLAN：機師個別科研 + 全域科研，皆唯讀）──────────────────────

import { where } from 'firebase/firestore'
import type { PilotResearch, GlobalResearch } from '../../types'
import { fetchCollection, fetchDocument } from './firestoreCore'
import { WORKER_ENABLED, fetchWorkerCollection } from './workerData'

export const getPilotResearch = (pilotId: string) =>
  fetchCollection<PilotResearch>('pilotResearch', [where('pilotId', '==', pilotId)])

// PLAN-029 Phase 3-1：SimulatorPage（前台）用；Worker 模式改走代理，Phase 3-2 收緊後仍運作。
export const getAllPilotResearch = (): Promise<PilotResearch[]> =>
  WORKER_ENABLED
    ? (fetchWorkerCollection('pilotResearch') as Promise<PilotResearch[]>)
    : fetchCollection<PilotResearch>('pilotResearch')

export const getGlobalResearch = async (): Promise<GlobalResearch | null> =>
  fetchDocument<GlobalResearch>('globalResearch', 'global')
