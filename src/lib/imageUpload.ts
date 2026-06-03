const CLOUDINARY_CLOUD_NAME    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME    as string
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET as string

const MAX_BYTES = 2 * 1024 * 1024

// ── 圖片壓縮工具 ──────────────────────────────────────────────────────────────

/** 將圖片壓縮為 WebP Blob；壓縮後仍超過 2MB 會 reject */
export async function compressToWebP(file: File, quality = 0.85): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(file)

    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('無法建立 canvas context')); return }
      ctx.drawImage(img, 0, 0)
      canvas.toBlob(
        (blob) => {
          if (!blob) { reject(new Error('圖片壓縮失敗')); return }
          if (blob.size >= MAX_BYTES) {
            reject(new Error('壓縮後圖片仍超過 2MB，請選擇更小的圖片'))
            return
          }
          resolve(blob)
        },
        'image/webp',
        quality,
      )
    }

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('圖片讀取失敗'))
    }

    img.src = objectUrl
  })
}

// ── Cloudinary 上傳 ───────────────────────────────────────────────────────────

/** 壓縮為 WebP → 上傳至 Cloudinary，回傳 secure_url */
export async function uploadImage(file: File, folder: string): Promise<string> {
  if (file.size >= MAX_BYTES) {
    throw new Error('圖片超過 2MB 限制')
  }
  const webp = await compressToWebP(file)

  const formData = new FormData()
  formData.append('file', webp)
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET)
  formData.append('folder', folder)

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: 'POST', body: formData },
  )
  if (!res.ok) throw new Error('圖片上傳失敗，請重試')
  const data = await res.json() as { secure_url: string }
  return data.secure_url
}
