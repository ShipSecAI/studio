import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Layout controls exposed to pages that render a custom header      */
/* ------------------------------------------------------------------ */

export interface LayoutControls {
  sidebarOpen: boolean;
  onSidebarToggle: () => void;
  isMobile: boolean;
}

/* ------------------------------------------------------------------ */
/*  Header slot state                                                 */
/* ------------------------------------------------------------------ */

/**
 * `undefined` — no page has claimed the slot → AppLayout renders the
 *               default AppTopBar (or hides it based on legacy pathname rules).
 * `null`      — page explicitly wants NO header.
 * `ReactNode` — page provides a fully custom header.
 */
type HeaderSlot = ReactNode | null | undefined;

interface PageHeaderContextValue {
  /** Current header slot value */
  headerSlot: HeaderSlot;
  /** Called by pages to claim / release the header slot */
  setHeaderSlot: (slot: HeaderSlot) => void;
  /** Layout props pages need to integrate with the shell (sidebar toggle, etc.) */
  layoutControls: LayoutControls;
}

const PageHeaderContext = createContext<PageHeaderContextValue | null>(null);

export { PageHeaderContext };

/* ------------------------------------------------------------------ */
/*  Provider — used by AppLayout                                      */
/* ------------------------------------------------------------------ */

export function PageHeaderProvider({
  children,
  layoutControls,
}: {
  children: ReactNode;
  layoutControls: LayoutControls;
}) {
  const [headerSlot, setHeaderSlot] = useState<HeaderSlot>(undefined);

  const value = useMemo(
    () => ({ headerSlot, setHeaderSlot, layoutControls }),
    [headerSlot, layoutControls],
  );

  return <PageHeaderContext.Provider value={value}>{children}</PageHeaderContext.Provider>;
}

/* ------------------------------------------------------------------ */
/*  Hooks — used by individual pages                                  */
/* ------------------------------------------------------------------ */

/**
 * Returns layout shell controls so a custom header can include the
 * sidebar toggle button, adapt to mobile, etc.
 */
export function useLayoutControls(): LayoutControls {
  const ctx = useContext(PageHeaderContext);
  if (!ctx) {
    throw new Error('useLayoutControls must be used inside <PageHeaderProvider>');
  }
  return ctx.layoutControls;
}

/**
 * Claim the header slot for the lifetime of the calling component.
 *
 * @param header - `ReactNode` for a custom header, or `null` for no header.
 *
 * The slot is automatically released when the component unmounts,
 * restoring the default AppTopBar for the next page.
 */
export function useCustomHeader(header: ReactNode | null) {
  const ctx = useContext(PageHeaderContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.setHeaderSlot(header);
    return () => ctx.setHeaderSlot(undefined);
  }, [ctx, header]);
}

/**
 * Read the current header slot (used by AppLayout to decide what to render).
 */
export function useHeaderSlot(): HeaderSlot {
  const ctx = useContext(PageHeaderContext);
  return ctx?.headerSlot;
}
