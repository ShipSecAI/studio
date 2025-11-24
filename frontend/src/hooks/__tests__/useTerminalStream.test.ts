import { describe, expect, it } from 'bun:test'
import { mergeTerminalChunks } from '../useTerminalStream'

const buildChunk = (index: number) => ({
  nodeRef: 'node-1',
  stream: 'pty',
  chunkIndex: index,
  payload: Buffer.from(`chunk-${index}`).toString('base64'),
  recordedAt: new Date().toISOString(),
})

describe('mergeTerminalChunks', () => {
  it('appends new chunks in order', () => {
    const existing = [buildChunk(1), buildChunk(2)]
    const incoming = [buildChunk(3), buildChunk(4)]

    const merged = mergeTerminalChunks(existing, incoming)

    expect(merged.map((chunk) => chunk.chunkIndex)).toEqual([1, 2, 3, 4])
  })

  it('deduplicates chunk indices', () => {
    const existing = [buildChunk(1), buildChunk(2)]
    const incoming = [buildChunk(2), buildChunk(3)]

    const merged = mergeTerminalChunks(existing, incoming)

    expect(merged.map((chunk) => chunk.chunkIndex)).toEqual([1, 2, 3])
  })

  it('applies buffer limit', () => {
    const existing = [buildChunk(1), buildChunk(2)]
    const incoming = [buildChunk(3), buildChunk(4), buildChunk(5)]

    const merged = mergeTerminalChunks(existing, incoming, { max: 3 })

    expect(merged.map((chunk) => chunk.chunkIndex)).toEqual([3, 4, 5])
  })
})
