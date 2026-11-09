export const MAX_UPLOAD_BYTES = 95 * 1024 * 1024
const MAX_UPLOAD_FILES = 50

export function splitUploads<T extends { size: number }>(files: readonly T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = []
  let size = 0
  for (const file of files) {
    if (batch.length && (batch.length === MAX_UPLOAD_FILES || size + file.size > MAX_UPLOAD_BYTES)) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(file)
    size += file.size
  }
  if (batch.length) batches.push(batch)
  return batches
}

export async function fitUpload(file: File): Promise<File> {
  if (file.size <= MAX_UPLOAD_BYTES) return file
  try {
    const image = await createImageBitmap(file)
    const canvas = document.createElement("canvas")
    try {
      const scale = Math.min(1, 2200 / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas unavailable")
      context.fillStyle = "#fff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9))
      if (!blob) throw new Error("Image encoding failed")
      return new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" })
    } finally {
      image.close()
      canvas.width = canvas.height = 0
    }
  } catch {
    throw new Error(`Could not resize ${file.name}. Try exporting it as a new JPG or PNG.`)
  }
}
