declare module 'bun:test' {
  interface Matchers<T = unknown> {
    toBeInTheDocument(): T extends Promise<any> ? Promise<void> : void
  }
}
