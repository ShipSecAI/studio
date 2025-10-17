import '@testing-library/jest-dom'
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
  function MockEventSource(this: any, url: string) {
    this.url = url
    this.readyState = 0
    this.onopen = null
    this.onmessage = null
    this.onerror = null

    setTimeout(() => {
      this.readyState = 1
      this.onopen?.call(this, new Event('open'))
    }, 0)
  }

  MockEventSource.prototype.addEventListener = function() {
    /* no-op */
  }

  MockEventSource.prototype.removeEventListener = function() {
    /* no-op */
  }

  MockEventSource.prototype.close = function() {
    this.readyState = 2
  }

  // @ts-expect-error mock assignment for tests
  globalThis.EventSource = MockEventSource as any
}