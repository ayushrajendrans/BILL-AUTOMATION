import assert from "node:assert/strict"
import { test } from "node:test"
import { MAX_UPLOAD_BYTES, splitUploads } from "../lib/upload-batches.ts"

test("splits a large selection without losing or reordering files", () => {
  const files = Array.from({ length: 320 }, (_, index) => ({ index, size: 1 }))
  const parts = splitUploads(files)
  assert.deepEqual(parts.map(part => part.length), Array(16).fill(20))
  assert.deepEqual(parts.flat(), files)
})

test("keeps each upload within the byte budget", () => {
  const files = [{ size: MAX_UPLOAD_BYTES - 1 }, { size: 1 }, { size: 1 }]
  const parts = splitUploads(files)
  assert.deepEqual(parts, [[files[0], files[1]], [files[2]]])
})

test("isolates an oversized poster for resizing before upload", () => {
  const files = [{ size: 1 }, { size: MAX_UPLOAD_BYTES + 1 }, { size: 1 }]
  assert.deepEqual(splitUploads(files), files.map(file => [file]))
})
