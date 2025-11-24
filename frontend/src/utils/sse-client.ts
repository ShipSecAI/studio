/**
 * EventSource-compatible SSE client using fetch with ReadableStream
 * This allows us to send custom headers (like Authorization) which
 * native EventSource doesn't support.
 */
export class FetchEventSource implements EventSource {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 2

  readonly CONNECTING = FetchEventSource.CONNECTING
  readonly OPEN = FetchEventSource.OPEN
  readonly CLOSED = FetchEventSource.CLOSED

  url: string
  readyState: number = FetchEventSource.CONNECTING
  withCredentials: boolean = false

  private eventListeners: Map<string, Set<(event: MessageEvent) => void>> = new Map()
  private onopenHandler: ((event: Event) => void) | null = null
  private onmessageHandler: ((event: MessageEvent) => void) | null = null
  private onerrorHandler: ((event: Event) => void) | null = null

  private controller: AbortController | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  constructor(
    url: string,
    options?: {
      headers?: Record<string, string>
      withCredentials?: boolean
    }
  ) {
    this.url = url
    if (options?.withCredentials) {
      this.withCredentials = options.withCredentials
    }

    this.connect(options?.headers)
  }
  
  addEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    _options?: boolean | AddEventListenerOptions
  ): void
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | AddEventListenerOptions
  ): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set())
    }
    this.eventListeners.get(type)!.add(listener as (event: MessageEvent) => void)
  }

  removeEventListener<K extends keyof EventSourceEventMap>(
    type: K,
    listener: (this: EventSource, ev: EventSourceEventMap[K]) => any,
    _options?: boolean | EventListenerOptions
  ): void
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    _options?: boolean | EventListenerOptions
  ): void {
    this.eventListeners.get(type)?.delete(listener as (event: MessageEvent) => void)
  }

  dispatchEvent(_event: Event): boolean {
    // Not needed for our use case
    return true
  }

  set onopen(handler: ((event: Event) => void) | null) {
    this.onopenHandler = handler
  }

  get onopen(): ((event: Event) => void) | null {
    return this.onopenHandler
  }

  set onmessage(handler: ((event: MessageEvent) => void) | null) {
    this.onmessageHandler = handler
  }

  get onmessage(): ((event: MessageEvent) => void) | null {
    return this.onmessageHandler
  }

  set onerror(handler: ((event: Event) => void) | null) {
    this.onerrorHandler = handler
  }

  get onerror(): ((event: Event) => void) | null {
    return this.onerrorHandler
  }

  close(): void {
    if (this.readyState === EventSource.CLOSED) {
      return
    }

    this.readyState = FetchEventSource.CLOSED
    this.controller?.abort()
    this.reader?.cancel().catch(() => {
      // Ignore cancel errors
    })
    this.reader = null
    this.controller = null
  }

  private async connect(headers?: Record<string, string>): Promise<void> {
    if (this.readyState === EventSource.CLOSED) {
      return
    }

    this.controller = new AbortController()
    this.readyState = FetchEventSource.CONNECTING

    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers: {
          'Accept': 'text/event-stream',
          // Don't send Cache-Control header - backend sets it on response
          // Including it causes CORS issues
          ...headers,
        },
        signal: this.controller.signal,
        credentials: this.withCredentials ? 'include' : 'same-origin',
      })

      if (!response.ok) {
        throw new Error(`SSE connection failed: ${response.status} ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error('Response body is null')
      }

      this.readyState = FetchEventSource.OPEN

      // Fire onopen event
      if (this.onopenHandler) {
        this.onopenHandler(new Event('open'))
      }
      this.fireEvent('open', new Event('open'))

      // Read the stream
      this.reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (this.readyState === FetchEventSource.OPEN) {
        const { done, value } = await this.reader.read()

        if (done) {
          break
        }

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        let eventType = 'message'
        let eventData = ''
        let eventId = ''

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.substring(6).trim()
          } else if (line.startsWith('data:')) {
            eventData += line.substring(5).trim() + '\n'
          } else if (line.startsWith('id:')) {
            eventId = line.substring(3).trim()
          } else if (line === '') {
            // Empty line indicates end of event
            if (eventData) {
              const data = eventData.trim()
              const messageEvent = new MessageEvent(eventType, {
                data,
                lastEventId: eventId || undefined,
              })

              // Fire type-specific event
              this.fireEvent(eventType, messageEvent)

              // Fire generic message event
              if (eventType !== 'message') {
                this.fireEvent('message', messageEvent)
              }

              // Call onmessage handler
              if (this.onmessageHandler) {
                this.onmessageHandler(messageEvent)
              }

              eventData = ''
              eventType = 'message'
              eventId = ''
            }
          }
        }
      }
    } catch (error) {
      if (this.controller?.signal.aborted) {
        // Connection was intentionally closed
        return
      }

      this.readyState = FetchEventSource.CLOSED
      const errorEvent = new Event('error')

      if (this.onerrorHandler) {
        this.onerrorHandler(errorEvent)
      }
      this.fireEvent('error', errorEvent)
    }
  }

  private fireEvent(type: string, event: Event | MessageEvent): void {
    const listeners = this.eventListeners.get(type)
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event as MessageEvent)
        } catch (error) {
          console.error(`Error in SSE event listener for ${type}:`, error)
        }
      }
    }
  }
}
