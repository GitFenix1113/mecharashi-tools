import assert from 'node:assert/strict'
import { test } from 'node:test'
import { UI_GROUPS, isUiArt, uiArchivePath, uiLocation, uiModuleInfo } from './gameUiModules.mjs'

const P = 'assets/gameproject/runtimeassets/ui/'

test('uiLocation：模組＝ui/uiimages/ 之後第一段，去掉 _abs 與 <模組>_atlas／_noatlas 這一層', () => {
  assert.deepEqual(uiLocation(`${P}uiimages/uiactivity_abs/uiactivity_noatlas/ob6/Img_x.png`), { module: 'uiactivity', sub: ['ob6'], text: false })
  assert.deepEqual(uiLocation(`${P}uiimages/uigacha/pilotob16_abs/Img_x.png`), { module: 'uigacha', sub: ['pilotob16'], text: false })
  assert.deepEqual(
    uiLocation(`${P}uiimages/uiplotactivitydetectiveob23_abs/uiplotactivitydetectiveob23_atlas/ob26/Img_x.png`),
    { module: 'uiplotactivitydetectiveob23', sub: ['ob26'], text: false },
  )
})

test('uiLocation：簡中文字圖標 text；不是 UI 圖回 null', () => {
  assert.deepEqual(uiLocation(`${P}textimages/chinese/pilotgachaimg_abs/Img_1_pilot_gacha_Erisa1_Raw.png`), { module: 'pilotgachaimg', sub: [], text: true })
  assert.equal(uiLocation('assets/gameproject/runtimeassets/pilot/pilotb01_abs/x.png'), null)
  assert.equal(uiLocation(''), null)
  assert.equal(uiLocation(undefined), null)
})

test('uiModuleInfo：完整名稱、前綴規則、沒登記的', () => {
  assert.equal(uiModuleInfo('uigacha').group, 'gacha')
  assert.equal(uiModuleInfo('uiplotactivitydetectiveob99').group, 'activity')   // 前綴規則：之後的新偵探活動不必改字典
  assert.equal(uiModuleInfo('pilotgachaimg', true).group, 'gacha')              // 住在 textimages 但字典有登記
  assert.equal(uiModuleInfo('somethingnew', true).group, 'text')
  assert.deepEqual(uiModuleInfo('uisomethingnew'), { group: '_unsorted', zh: '', known: false })
})

test('isUiArt：_Raw、長邊 ≥ 512、或 banner 才算；按鈕、遮罩、特效、圖集整張不算', () => {
  assert.equal(isUiArt({ name: 'Img_x_Raw', width: 100, height: 100 }), true)
  assert.equal(isUiArt({ name: 'Img_x', width: 600, height: 100 }), true)
  assert.equal(isUiArt({ name: 'Img_1_pilot_gacha_banner_X', width: 231, height: 111 }), true)
  assert.equal(isUiArt({ name: 'Img_x', width: 300, height: 300 }), false)
  assert.equal(isUiArt({ name: 'Btn_x_Raw', width: 1024, height: 1024 }), false)
  assert.equal(isUiArt({ name: 'Img_BG_Mask_Raw', width: 1024, height: 1024 }), false)
  assert.equal(isUiArt({ name: 'sactx-0-2048x2048-BC7-UICom-1', width: 2048, height: 2048 }), false)
})

test('uiArchivePath：ui/<用途>/<模組>/<子夾>/<官方檔名>；系統介面與文字圖不封存', () => {
  const row = (asset, name = 'Img_x_Raw') => ({ name, width: 1024, height: 1024, asset_path: `${P}${asset}/${name}.png` })
  assert.equal(uiArchivePath(row('uiimages/uigacha/pilotob16_abs')), 'ui/gacha/uigacha/pilotob16/Img_x_Raw')
  assert.equal(uiArchivePath(row('uiimages/uiactivity_abs/uiactivity_noatlas/ob6')), 'ui/activity/uiactivity/ob6/Img_x_Raw')
  assert.equal(uiArchivePath(row('uiimages/uishop_abs/uishop_noatlas')), null)
  assert.equal(uiArchivePath(row('textimages/chinese/ob19_abs')), null)
  assert.equal(uiArchivePath(row('uiimages/uibrandnew_abs')), 'ui/_unsorted/uibrandnew/Img_x_Raw')
})

test('UI_GROUPS：每個用途都有中文名與是否封存', () => {
  for (const [k, v] of Object.entries(UI_GROUPS)) {
    assert.equal(typeof v.zh, 'string', k)
    assert.equal(typeof v.archive, 'boolean', k)
  }
})
