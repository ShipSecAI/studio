import type { StoreApi, UseBoundStore } from 'zustand'
import { useStore } from 'zustand'

type ExtractState<S> = S extends { getState: () => infer T } ? T : never

type Selector<S, T> = (state: ExtractState<S>) => T

type EqualityFn<T> = (a: T, b: T) => boolean

type StoreWithSelectors<S extends UseBoundStore<StoreApi<object>>> = UseBoundStore<StoreApi<ExtractState<S>>> & {
  use: <T>(selector: Selector<S, T>, equalityFn?: EqualityFn<T>) => T
}

const identity = <T>(value: T) => value

export const createSelectors = <S extends UseBoundStore<StoreApi<object>>>(store: S) => {
  const typedStore = store as StoreWithSelectors<S>
  typedStore.use = <T>(selector: Selector<S, T> = identity as Selector<S, T>, equalityFn?: EqualityFn<T>) =>
    useStore(store, selector, equalityFn)
  return typedStore
}

export type WithSelectors<S extends UseBoundStore<StoreApi<object>>> = ReturnType<typeof createSelectors<S>>
