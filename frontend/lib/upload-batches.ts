export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024
export const MAX_POSTER_BYTES = 1024 * 1024
const MAX_UPLOAD_FILES = 20
const imageTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
}

export function splitUploads<T extends { size: number }>(files: readonly T[]): T[][] {
  const batches: T[][] = []
  let batch: T[] = []
  let size = 0
  for (const file of files) {
    const uploadSize = Math.min(file.size, MAX_POSTER_BYTES)
    if (batch.length && (batch.length === MAX_UPLOAD_FILES || size + uploadSize > MAX_UPLOAD_BYTES)) {
      batches.push(batch)
      batch = []
      size = 0
    }
    batch.push(file)
    size += uploadSize
  }
  if (batch.length) batches.push(batch)
  return batches
}

export async function fitUpload(file: File): Promise<File> {
  if (file.size <= MAX_POSTER_BYTES) {
    if (Object.values(imageTypes).includes(file.type)) return file
    const extension = file.name.split(".").pop()?.toLowerCase() || ""
    const type = imageTypes[extension]
    return type ? new File([file], file.name, { type }) : file
  }
  try {
    const image = await createImageBitmap(file)
    const canvas = document.createElement("canvas")
    try {
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas unavailable")
      for (const [maxSide, quality] of [[2200, 0.9], [2200, 0.8], [1600, 0.78]]) {
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height))
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        context.fillStyle = "#fff"
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", quality))
        if (blob && blob.size <= MAX_POSTER_BYTES) {
          return new File([blob], file.name, { type: "image/jpeg" })
        }
      }
      throw new Error("Image could not fit in the upload")
    } finally {
      image.close()
      canvas.width = canvas.height = 0
    }
  } catch {
    throw new Error(`Could not resize ${file.name}. Try exporting it as a new JPG or PNG.`)
  }
}
