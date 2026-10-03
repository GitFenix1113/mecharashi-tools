import { useEffect, useRef, useState } from 'react'
import { assetUrl } from '../../utils/assets'

/**
 * 故事館背景音樂開關（PLAN-042-C E-2）。官網 hero 區有一首自動循環的 BGM；
 * 我們只做「開關」：預設關（瀏覽器的 autoplay 政策本來就不准無互動播放）、
 * 偏好存 localStorage、離館（本元件卸載）即停止。音檔 96kbps 的 96 秒節錄，自託管。
 *
 * ⚠ `<audio preload="none">`：關著的時候一個位元組都不下載，開了才抓。
 * ⚠ 上次偏好是「開」時，掛載後會**試著**自動播；被 autoplay 政策擋下就靜靜退回「關」，
 *   不彈訊息——那是瀏覽器的規則，不是錯誤。使用者點一下就會播。
 */
const PREF_KEY = 'mecharashi_lore_bgm'
const VOLUME = 0.35

function readPref(): boolean {
  try { return localStorage.getItem(PREF_KEY) === 'on' } catch { return false }
}
function writePref(on: boolean) {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* 無痕模式等情況：不記偏好也沒關係 */ }
}

export default function LoreBgmToggle({ className }: { className?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  // 依上次偏好嘗試自動播；失敗（autoplay 被擋）就維持關。
  useEffect(() => {
    const el = audioRef.current
    if (!el || !readPref()) return
    el.volume = VOLUME
    el.play().then(() => setPlaying(true), () => setPlaying(false))
  }, [])

  // 離館：元件隨 immersive header 一起卸載，停掉音樂並釋放解碼器。
  useEffect(() => {
    const el = audioRef.current
    return () => { el?.pause() }
  }, [])

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) {
      el.pause()
      setPlaying(false)
      writePref(false)
    } else {
      el.volume = VOLUME
      el.play().then(() => { setPlaying(true); writePref(true) }, () => setPlaying(false))
    }
  }

  return (
    <>
      <audio ref={audioRef} src={assetUrl('/audio/lore-bgm.mp3')} loop preload="none" />
      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? '關閉背景音樂' : '開啟背景音樂'}
        title={playing ? '背景音樂：開' : '背景音樂：關'}
        className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors cursor-pointer ${
          playing
            ? 'border-accent-orange/40 bg-accent-orange/15 text-accent-orange'
            : 'border-border bg-bg-card text-text-secondary hover:text-text-primary hover:border-border-accent'
        } ${className ?? ''}`}
      >
        <span aria-hidden="true">{playing ? '♪' : '♩'}</span>
        <span className="hidden sm:inline">BGM</span>
      </button>
    </>
  )
}
