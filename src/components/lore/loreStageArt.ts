// PLAN-042-D B-1：舞台的「這一套立繪長什麼樣」——構圖變體、用哪幾張圖。
//
// 構圖在**渲染前**決定（042-A 檔頭第 ③ 條的同一個理由）：直式全身、橫式半身、官網圖層、場景插畫
// 四種的取景與尺寸都不同，等圖載完才換構圖，整個舞台會在那一刻跳一次。
// 所以這裡只看 build 產生的索引（hasPilotArt／pilotOfficialArt／GAME_PILOT_SKINS），不等圖。

import { assetUrl, hasPilotArt, imageCandidates, pilotArtDir, pilotFullArtPath, pilotKeyArtPath, pilotOfficialArt } from '../../utils/assets'
import { pilotGameArt, type PilotSkinArt } from '../../utils/gameArt'
import { LORE_ART_TUNING } from './loreArtTuning'
import type { Pilot } from '../../types'

/**
 * 'tall'     站上原稿 art.webp（直式全身）：依高度放大 1.52 倍、靠頂取景（頭到大腿）；全身留給鑑賞模式
 * 'wide'     官方 Raw（1240×1080 橫式半身）：全高
 * 'official' 官網 hero 圖層（8 位）：彩圖＋手繪線稿＋名字層
 * 'scene'    帶背景的場景插畫外觀（四角官方已暈開）：置中略小、留紙邊
 */
export type StageVariant = 'tall' | 'wide' | 'official' | 'scene'

export interface StageArt {
  /** 這一套立繪的識別：換外觀時用它判斷「是不是同一套」 */
  key: string
  variant: StageVariant
  /** 彩圖（已套 BASE_URL） */
  color: string
  /** 線稿來源：filtered 時是同一張彩圖、經 SVG 濾鏡 #lore-sketch 算線 */
  line: string
  filtered: boolean
  /** false＝這位關掉線稿層（LORE_ART_TUNING） */
  lineArt: boolean
  /** 官網名字層（只有官網 8 位的預設立繪有） */
  nameLayer?: string
  /** 鑑賞模式的圖：有全身原稿就給全身 */
  full: string
}

type StagePilot = Pick<Pilot, 'id' | 'portrait' | 'gameId' | 'artKey'>

/** 這位的預設立繪；任何圖都沒有（理論上不該發生）回 null，舞台顯示「立繪未建檔」。 */
export function defaultStageArt(pilot: StagePilot): StageArt | null {
  const lineArt = LORE_ART_TUNING[pilotArtDir(pilot) ?? '']?.lineArt !== false
  const tall = hasPilotArt(pilot) ? pilotKeyArtPath(pilot) : undefined
  const wide = pilotFullArtPath(pilot)
  const full = assetUrl(tall ?? wide ?? '')
  const official = pilotOfficialArt(pilot)
  if (official) {
    return { key: `${pilot.id}|official`, variant: 'official', color: assetUrl(official.color), line: assetUrl(official.line), filtered: false, lineArt, nameLayer: assetUrl(official.name), full }
  }
  if (tall) return { key: `${pilot.id}|tall`, variant: 'tall', color: assetUrl(tall), line: assetUrl(tall), filtered: true, lineArt, full }
  if (wide) return { key: `${pilot.id}|wide`, variant: 'wide', color: assetUrl(wide), line: assetUrl(wide), filtered: true, lineArt, full }
  return null
}

/** 選了某套外觀時的立繪（外觀都是 1240×1080 的 Raw：去背的走 wide、場景插畫走 scene）。 */
export function skinStageArt(pilot: StagePilot, skin: PilotSkinArt): StageArt {
  const url = assetUrl(skin.raw)
  return {
    key: `${pilot.id}|${skin.key}`,
    variant: skin.scene ? 'scene' : 'wide',
    color: url, line: url, filtered: true,
    lineArt: LORE_ART_TUNING[pilotArtDir(pilot) ?? '']?.lineArt !== false,
    full: url,
  }
}

/** 立繪站哪一側。官網 8 位一律左（名字層的構圖）；其餘看 LORE_ART_TUNING，沒寫＝左。 */
export function loreSideOf(pilot: StagePilot): 'left' | 'right' {
  if (pilotOfficialArt(pilot)) return 'left'
  return LORE_ART_TUNING[pilotArtDir(pilot) ?? '']?.side ?? 'left'
}

/**
 * 換人前預載：等圖真的能畫（decode）。失敗也放行；最多等 DECODE_TIMEOUT_MS——
 * 慢網路不能讓換人卡住，而且背景分頁裡 decode() 可能一直不 resolve（042-C 實測過）。
 */
const DECODE_TIMEOUT_MS = 2000
const decoded = new Map<string, Promise<void>>()
export function preloadImages(urls: readonly (string | undefined)[]): Promise<void> {
  const all = Promise.all(urls.filter((u): u is string => !!u).map((u) => {
    let p = decoded.get(u)
    if (!p) {
      const img = new Image()
      img.src = u
      p = img.decode().catch(() => {})
      decoded.set(u, p)
    }
    return p
  })).then(() => {})
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, DECODE_TIMEOUT_MS))])
}
export function preloadStageArt(art: StageArt | null): Promise<void> {
  return art ? preloadImages([art.color, art.filtered ? undefined : art.line, art.nameLayer]) : Promise.resolve()
}

/**
 * 圓形頭像用的候選（切換列、名冊、外觀列的「預設」）：官方 90² 頭部特寫 → 340² 頭像 → DB 的 portrait。
 * 空字串不會進候選（M-16：<img src=""> 會重新請求本頁）。
 */
export function pilotHeadCandidates(pilot: Pick<Pilot, 'portrait' | 'portraitUrl' | 'gameId' | 'artKey'>): string[] {
  return imageCandidates(pilotGameArt(pilot, 'head'), pilotGameArt(pilot, 'half'), pilot.portrait, pilot.portraitUrl)
}
