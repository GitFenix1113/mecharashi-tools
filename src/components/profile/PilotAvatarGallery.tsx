import { useState } from 'react'
import { usePilots } from '../../hooks/useFirestore'
import { assetUrl, pilotPortraitPath } from '../../utils/assets'
import { setPilotAvatar } from '../../lib/profileApi'

interface Props {
  uid: string
  currentPilotId?: string | null
  onSuccess: () => void
}

export default function PilotAvatarGallery({ uid, currentPilotId, onSuccess }: Props) {
  const { data: pilots, loading } = usePilots()
  const [search, setSearch]       = useState('')
  const [selected, setSelected]   = useState<string | null>(currentPilotId ?? null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const filtered = pilots.filter((p) =>
    !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  async function handleConfirm() {
    if (!selected) return
    setSaving(true)
    setError(null)
    try {
      await setPilotAvatar(uid, selected)
      onSuccess()
    } catch {
      setError('儲存失敗，請重試')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-8 text-center text-text-dim text-sm">載入機師資料中...</div>
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        type="text"
        placeholder="搜尋機師名稱..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2 rounded-lg bg-bg-dark border border-border text-text-primary text-sm focus:outline-none focus:border-accent-purple placeholder:text-text-dim"
      />

      <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 max-h-64 overflow-y-auto pr-1">
        {filtered.map((pilot) => {
          const isSelected = selected === pilot.id
          return (
            <button
              key={pilot.id}
              onClick={() => setSelected(pilot.id)}
              className={`flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 transition-all cursor-pointer ${
                isSelected
                  ? 'border-accent-purple bg-accent-purple/10'
                  : 'border-transparent bg-bg-dark hover:border-border-accent'
              }`}
            >
              <img
                src={assetUrl(pilotPortraitPath(pilot) ?? '')}
                alt={pilot.name}
                className="w-12 h-12 rounded-full object-cover border border-border"
                draggable={false}
              />
              <span className={`text-[10px] leading-tight text-center line-clamp-1 ${isSelected ? 'text-accent-purple font-medium' : 'text-text-dim'}`}>
                {pilot.name}
              </span>
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-accent-red">{error}</p>}

      <button
        onClick={handleConfirm}
        disabled={!selected || saving}
        className="w-full py-2.5 bg-accent-purple text-white font-bold rounded-lg hover:opacity-90 transition-opacity disabled:opacity-40 text-sm cursor-pointer"
      >
        {saving ? '儲存中...' : '確認選取'}
      </button>
    </div>
  )
}
