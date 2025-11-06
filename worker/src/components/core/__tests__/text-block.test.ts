import { describe, it, expect, beforeAll } from 'bun:test'
import { componentRegistry } from '../../index'
import type { TextBlockInput, TextBlockOutput } from '../text-block'

describe('text-block component', () => {
  beforeAll(async () => {
    await import('../../index')
  })

  it('registers with no input or output ports', () => {
    const component = componentRegistry.get<TextBlockInput, TextBlockOutput>('core.ui.text')
    expect(component).toBeDefined()
    expect(component?.metadata?.inputs).toEqual([])
    expect(component?.metadata?.outputs).toEqual([])
  })

  it('emits a progress update when content is provided', async () => {
    const component = componentRegistry.get<TextBlockInput, TextBlockOutput>('core.ui.text')
    if (!component) throw new Error('Component not registered')

    const emitted: any[] = []
    const context: any = {
      runId: 'run-test',
      componentRef: 'core.ui.text',
      logger: { info: () => {}, error: () => {} },
      emitProgress: (progress: unknown) => {
        emitted.push(progress)
      },
    }

    const params = component.inputSchema.parse({
      title: 'Reminder',
      content: 'Review the execution summary before approval.',
    })

    const result = await component.execute(params, context)

    expect(result).toEqual({})
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      message: 'Displayed text note: Reminder',
      level: 'info',
    })
  })

  it('does not emit progress when content is empty', async () => {
    const component = componentRegistry.get<TextBlockInput, TextBlockOutput>('core.ui.text')
    if (!component) throw new Error('Component not registered')

    const emitted: any[] = []
    const context: any = {
      runId: 'run-empty',
      componentRef: 'core.ui.text',
      logger: { info: () => {}, error: () => {} },
      emitProgress: (progress: unknown) => {
        emitted.push(progress)
      },
    }

    const params = component.inputSchema.parse({
      title: '',
      content: '   ',
    })

    const result = await component.execute(params, context)

    expect(result).toEqual({})
    expect(emitted).toHaveLength(0)
  })
})
