import { useStore } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'

type ExtractState<S> = S extends { getState: () => infer T } ? T : never

interface StoreWithSelectors<S extends UseBoundStore<StoreApi<object>>> extends UseBoundStore<StoreApi<ExtractState<S>>> {
  use: <T>(selector: (state: ExtractState<S>) => T, equalityFn?: (a: T, b: T) => boolean) => T
}

const identity = <T>(value: T) => value

export const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(store: S) => {
  const typedStore = store as StoreWithSelectors<S>
  typedStore.use = (selector = identity as any, equalityFn) =>
    useStore(store, selector, equalityFn)
  return typedStore
}

export type WithSelectors<S extends UseBoundStore<StoreApi<object>>> = ReturnType<typeof createSelectors<S>>
