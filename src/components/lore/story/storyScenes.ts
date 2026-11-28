// 劇情故事館的場景條（PLAN-042-J）：圖片路徑與「場景圖」開關的偏好。
//
// 圖由 scripts/import-story.mjs --write 從台版解包轉檔放進 public/images/game/story/：
//   <官方檔名>.webp         對白背景 CG，1920×592（例 P001_Raw.webp）
//   <官方檔名>_strip.webp   主線區域地圖裁成的橫幅，1920×420（衍生檔，整張 2048² 太大、前台也只露一條）
//
// 這裡只回傳站內路徑、不套 BASE_URL（呼叫端走 assetUrl()），所以 node:test 可以直接拿來核對檔案在不在。

export const STORY_SCENE_DIR = '/images/game/story'

/** 對白背景 CG 的固有尺寸：<img> 的 width／height 用它，載入前就佔好位置、不會把文字往下推 */
export const SCENE_SIZE = { width: 1920, height: 592 } as const
export const MAP_STRIP_SIZE = { width: 1920, height: 420 } as const

export const scenePath = (key: string) => `${STORY_SCENE_DIR}/${key}.webp`
export const mapStripPath = (name: string) => `${STORY_SCENE_DIR}/${name}_strip.webp`

/** 說話者頭像：book.faces 的一筆（例 pilots/10103101/Pilot_10103101A）→ 90² 的 _head.webp（PLAN-054 已上站的圖，不另外匯入） */
export const FACE_SIZE = 90
export const facePath = (face: string) => `/images/game/${face}_head.webp`

/**
 * 「場景圖」「頭像」兩個開關：個人偏好，只存在這台裝置（localStorage）。預設都開。
 * 讀不到（無痕視窗、儲存被擋）就當預設；寫不進去也不影響這次瀏覽。
 */
export const SCENE_PREF_KEY = 'mecharashi_story_scenes'
export const FACE_PREF_KEY = 'mecharashi_story_faces'

export function readStoryPref(key: string): boolean {
  try {
    return globalThis.localStorage?.getItem(key) !== 'off'
  } catch {
    return true
  }
}

export function writeStoryPref(key: string, on: boolean): void {
  try {
    globalThis.localStorage?.setItem(key, on ? 'on' : 'off')
  } catch {
    /* 存不了偏好也沒關係：這次瀏覽照樣切換 */
  }
}
