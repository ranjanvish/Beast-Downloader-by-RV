/** Structured metadata must never be silently truncated like diagnostic logs. */
export const createMetadataOutputBuffer = (maxBytes = 128 * 1024 * 1024) => {
  let chunks: Buffer[] = []
  let bytes = 0
  let overflow = false
  return {
    append(chunk: Buffer): boolean {
      if (overflow) {
        return false
      }
      bytes += chunk.length
      if (bytes > maxBytes) {
        overflow = true
        chunks = []
        return false
      }
      chunks.push(chunk)
      return true
    },
    get(): string {
      if (overflow) {
        throw new Error(
          'This link returned too much video information. Try a single video or a smaller playlist.'
        )
      }
      // Decode once so multibyte titles split across process chunks stay intact.
      const result = Buffer.concat(chunks, bytes).toString('utf8')
      chunks = []
      bytes = 0
      return result
    }
  }
}
