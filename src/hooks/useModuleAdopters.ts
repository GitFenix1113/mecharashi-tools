import { useCallback, useMemo } from 'react'
import type { Mech, Module } from '../types'
import { useMechs } from './useFirestore'

export interface ModuleAdopter {
  id: string
  name: string
  /** 查得到機甲資料時帶入，供縮圖使用；查無（斷鏈）時為 undefined，顯示層退回名稱 chip */
  mech?: Mech
}

/**
 * 模組 ID → 採用此模組的機甲清單。
 *
 * 正向資料只存在 mechs 端（module4Id / module8Id / moduleFixedIds），模組本身不知道誰在用它，
 * 因此必須反查。同一個 8 級模組可被多台機甲共用。
 *
 * 零額外 Firestore read：mechs 早已由 GameDataContext 載入並快取，這裡純記憶體運算。
 */
export function useModuleAdopters() {
  const { data: mechs } = useMechs()

  const byModuleId = useMemo(() => {
    const map = new Map<string, Mech[]>()
    const add = (modId: string | null | undefined, mech: Mech) => {
      if (!modId) return
      const arr = map.get(modId)
      if (arr) {
        if (!arr.some((m) => m.id === mech.id)) arr.push(mech)
      } else {
        map.set(modId, [mech])
      }
    }
    for (const mech of mechs) {
      add(mech.module4Id, mech)
      add(mech.module8Id, mech)
      for (const fid of mech.moduleFixedIds ?? []) add(fid, mech)
    }
    return map
  }, [mechs])

  /** 反查優先；查無時退回模組自身的 boundMechId（連機甲都查不到就只顯示 ID）。 */
  return useCallback(
    (mod: Module): ModuleAdopter[] => {
      const used = byModuleId.get(mod.id)
      if (used?.length) {
        return used
          .map((mech) => ({ id: mech.id, name: mech.name, mech }))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
      }
      if (!mod.boundMechId) return []
      const mech = mechs.find((m) => m.id === mod.boundMechId)
      return [{ id: mod.boundMechId, name: mech?.name ?? mod.boundMechId, mech }]
    },
    [byModuleId, mechs],
  )
}
