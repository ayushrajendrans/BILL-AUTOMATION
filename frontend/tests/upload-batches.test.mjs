import assert from "node:assert/strict"
import { test } from "node:test"
import { fitUpload, MAX_POSTER_BYTES, MAX_UPLOAD_BYTES, splitUploads } from "../lib/upload-batches.ts"

test("splits a large selection without losing or reordering files", () => {
  const files = Array.from({ length: 320 }, (_, index) => ({ index, size: 1 }))
  const parts = splitUploads(files)
  assert.deepEqual(parts.map(part => part.length), Array(16).fill(20))
  assert.deepEqual(parts.flat(), files)
})

test("keeps each upload within the byte budget", () => {
  const files = Array.from({ length: 5 }, () => ({ size: MAX_POSTER_BYTES }))
  const parts = splitUploads(files)
  assert.equal(files.slice(0, 4).reduce((size, file) => size + file.size, 0), MAX_UPLOAD_BYTES)
  assert.deepEqual(parts, [files.slice(0, 4), files.slice(4)])
})

test("plans a 310-poster selection using the compressed size of large posters", () => {
  const files = Array.from({ length: 310 }, (_, index) => ({ index, size: 13 * MAX_POSTER_BYTES }))
  const parts = splitUploads(files)
  assert.equal(parts.length, 78)
  assert.deepEqual(parts.flat(), files)
})

test("uses the image extension when the browser omits its MIME type", async () => {
  const original = new File(["test"], "03:09 poster.PNG")
  const upload = await fitUpload(original)
  assert.equal(upload.name, original.name)
  assert.equal(upload.type, "image/png")
  assert.equal(await upload.text(), "test")
})
