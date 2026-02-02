import { NoOpTimingAdapter, type IHttpTimingAdapter } from './interface';
import { UndiciTimingAdapter } from './undici.adapter';

let adapter: IHttpTimingAdapter | undefined;

export function getTimingAdapter(): IHttpTimingAdapter {
  if (adapter) {
    return adapter;
  }

  try {
    adapter = new UndiciTimingAdapter();
  } catch {
    adapter = new NoOpTimingAdapter();
  }

  return adapter;
}

export function resetTimingAdapter(): void {
  adapter?.dispose();
  adapter = undefined;
}
