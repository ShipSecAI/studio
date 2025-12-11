#!/usr/bin/env bun

/**
 * Starts a workflow run and dumps its SSE stream (trace/logs/terminal/etc.) to a file.
 *
 * Usage:
 *   bun run scripts/capture-run-stream.ts <workflowId> [outputFile]
 */

import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3211'
const WORKFLOW_ID = process.argv[2] ?? '1d776999-255d-4541-9fac-8668da3006f9'
const OUTPUT_PATH =
  process.argv[3] ??
  join('.playground', `run-stream-${Date.now().toString(36)}.log`)

const BASIC_AUTH = Buffer.from('admin:admin').toString('base64')
const COMMON_HEADERS = {
  Authorization: `Basic ${BASIC_AUTH}`,
  'X-Organization-Id': 'local-dev',
}

async function ensureOutputDir(path: string) {
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.'
  if (dir && dir !== '.') {
    await mkdir(dir, { recursive: true })
  }
}

async function startRun() {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/run`,
    {
      method: 'POST',
      headers: {
        ...COMMON_HEADERS,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `Failed to start workflow ${WORKFLOW_ID}: ${response.status} ${response.statusText} - ${text}`,
    )
  }

  const payload = await response.json()
  const runId = payload.runId ?? payload.executionId ?? payload.id
  if (!runId) {
    throw new Error(
      `Start response missing runId: ${JSON.stringify(payload, null, 2)}`,
    )
  }

  return { runId, payload }
}

async function captureStream(runId: string, filePath: string) {
  await ensureOutputDir(filePath)
  const streamUrl = `${API_BASE_URL}/api/v1/workflows/runs/${runId}/stream`
  const response = await fetch(streamUrl, {
    headers: COMMON_HEADERS,
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(
      `Failed to subscribe to stream ${streamUrl}: ${response.status} ${response.statusText} - ${text}`,
    )
  }

  const file = createWriteStream(filePath, { flags: 'w' })
  file.write(`# Workflow ${WORKFLOW_ID} run ${runId}\n`)
  file.write(`# Stream URL: ${streamUrl}\n`)
  file.write(`# Captured at: ${new Date().toISOString()}\n\n`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let finished = false

  while (!finished) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, index).replace(/\r/g, '')
      buffer = buffer.slice(index + 2)
      if (rawEvent.trim().length === 0) {
        continue
      }
      file.write(rawEvent + '\n\n')
      if (rawEvent.startsWith('event: complete')) {
        finished = true
        break
      }
    }
  }

  file.end()
  return filePath
}

async function main() {
  console.log(
    `Starting workflow ${WORKFLOW_ID} via ${API_BASE_URL}/api/v1/workflows/${WORKFLOW_ID}/run`,
  )
  const { runId } = await startRun()
  console.log(`Run started: ${runId}`)
  console.log(`Subscribing to SSE stream and writing to ${OUTPUT_PATH} ...`)
  const path = await captureStream(runId, OUTPUT_PATH)
  console.log(`Stream capture completed: ${path}`)
}

main().catch((error) => {
  console.error('Failed to capture run stream', error)
  process.exit(1)
})
