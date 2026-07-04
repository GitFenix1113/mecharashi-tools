import { useMemo } from 'react'
import { usePatchVersions } from './usePatchVersions'

/**
 * 遊戲版本號清單（降序、去重），連動即時版本資料
 * （usePatchVersions：Firestore 優先、靜態 PATCH_VERSIONS fallback）。
 *
 * 供「登場版本」欄位的後台下拉使用：下拉選項＝版本博物館的實際版本，
 * 新版本一加進 patchVersions 就自動出現在下拉，免再改靜態清單（杜絕 v3.4 那種落差）。
 */
export function useGameVersions(): string[] {
  const { data } = usePatchVersions()
  return useMemo(
    () =>
      Array.from(new Set(data.map((v) => v.version))).sort(
        (a, b) => parseFloat(b) - parseFloat(a),
      ),
    [data],
  )
}
