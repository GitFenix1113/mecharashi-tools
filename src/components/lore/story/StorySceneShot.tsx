import { useState } from 'react'
import { assetUrl } from '../../../utils/assets'
import { MAP_STRIP_SIZE, SCENE_SIZE } from './storyScenes'

/**
 * 場景條的一格（PLAN-042-J）：換場景時插在對白之間的橫幅，當「定場鏡頭」。
 * 不做滿版背景——圖壓在字底下正是 PLAN-042-I 才解掉的「底圖干擾閱讀」。
 *
 *   · 裝飾性：alt=""＋aria-hidden，螢幕閱讀器不念。
 *   · 寬高屬性先佔好比例：lazy 圖晚到也不會把正在讀的字往下推。
 *   · 載入完才淡入（reduced-motion 時直接出現）；載入失敗整格收掉，不留破圖框。
 *
 * as="li" 用在對白清單裡（與戰中分隔線同一層），as="figure" 用在段落開頭的戰場地圖。
 */
export function StorySceneShot({ path, map = false, caption, as: Tag = 'figure' }: {
  path: string
  map?: boolean
  caption?: string
  as?: 'figure' | 'li'
}) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  if (state === 'failed') return null
  const size = map ? MAP_STRIP_SIZE : SCENE_SIZE
  return (
    <Tag
      className={`lore-story-shot${map ? ' is-map' : ''}${state === 'loaded' ? ' is-loaded' : ''}`}
      aria-hidden="true"
    >
      <img
        src={assetUrl(path)} alt="" width={size.width} height={size.height}
        loading="lazy" decoding="async"
        onLoad={() => setState('loaded')} onError={() => setState('failed')}
      />
      {caption && <span className="lore-story-shot__cap">{caption}</span>}
    </Tag>
  )
}
