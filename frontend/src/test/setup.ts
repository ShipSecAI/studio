import '@testing-library/jest-dom/vitest'
import globalJsdom from 'global-jsdom'

if (typeof document === 'undefined') {
  globalJsdom('<!doctype html><html><body></body></html>', { url: 'http://localhost' })
}

if (typeof window !== 'undefined' && window.HTMLElement) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: function scrollIntoView() {
      /* noop for tests */
    },
    configurable: true,
  })
}

if (typeof globalThis.EventSource === 'undefined') {
    class MockEventSource {
      url: string
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((_message: MessageEvent) => void) | null = null
      onerror: (() => void) | null = null

    constructor(url: string) {
      this.url = url

      setTimeout(() => {
        this.readyState = 1
        this.onopen?.call(this)
      }, 0)
    }

    addEventListener() {
      /* no-op */
    }

    removeEventListener() {
      /* no-op */
    }

    close() {
      this.readyState = 2
    }
  }

  globalThis.EventSource = MockEventSource as unknown as typeof EventSource
}