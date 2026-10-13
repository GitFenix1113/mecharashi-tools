/**
 * 場景插畫外觀（PLAN-042-D）的判定與「鑑賞版」產圖——import-game-assets.mjs（產檔）與 generate-art-index.mjs（索引）共用。
 *
 * 場景外觀＝連背景一起畫的 Raw（1240×1080）：官方把四周暈成透明，好疊在遊戲的卡面上。
 * 故事館舞台要的就是這個暈邊（融進紙面），但全身鑑賞時它把半張圖藏起來了（2026-10-13 站長回報）。
 *
 * ⚠ 透明像素底下的畫面其實還在（原始 PNG 與站上的 WebP 都是），拿掉 alpha 就看得到完整場景——
 *   但前台救不回來：瀏覽器解碼時會先預乘 alpha，alpha＝0 的像素顏色直接變 0。所以在匯入端另存一張。
 * ⚠ 不是整張拿掉 alpha：13 套裡有 3 套（10103113B、10103152B、10103166B）最角落有沒畫完的色塊
 *   （官方反正會暈掉，所以沒處理）。改成 alpha × 8：暈邊收窄成原本約 1/8 的細邊、畫面幾乎全露，
 *   角落 alpha≈0 的雜色仍是透明。× 16 起邊緣會因量化變鋸齒（2026-10-13 四檔並排比較過）。
 */
import sharp from 'sharp'

/** 透明像素（alpha < 8）佔比低於這個值＝場景插畫；去背的造型通常 > 40% */
export const SCENE_MAX_TRANSPARENT = 0.25
/** 鑑賞版的 alpha 增益（見檔頭） */
export const SCENE_VIEW_ALPHA_GAIN = 8

/** 透明像素佔比 */
export async function transparentRatio(input) {
  const { data, info } = await sharp(input).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  let n = 0
  for (let i = 0; i < data.length; i++) if (data[i] < 8) n++
  return n / (info.width * info.height)
}

/** 場景外觀的鑑賞版（WebP q82，同 core）；不是場景（去背的造型沒有被暈掉的背景可救）回 null。 */
export async function sceneViewWebp(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let clear = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] < 8) clear++
  if (clear / (info.width * info.height) >= SCENE_MAX_TRANSPARENT) return null
  for (let i = 3; i < data.length; i += 4) data[i] = Math.min(255, data[i] * SCENE_VIEW_ALPHA_GAIN)
  return sharp(data, { raw: info }).webp({ quality: 82 }).toBuffer()
}
