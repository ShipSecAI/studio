import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const posthogState = {
  loaded: false,
  flags: {} as Record<string, boolean | undefined>,
  listener: null as null | (() => void),
};

const onFeatureFlagsMock = mock((callback: () => void) => {
  posthogState.listener = callback;
  return () => {
    if (posthogState.listener === callback) {
      posthogState.listener = null;
    }
  };
});

const isFeatureEnabledMock = mock((key: string) => posthogState.flags[key]);
const reloadFeatureFlagsMock = mock(() => {
  posthogState.listener?.();
});

mock.module('posthog-js', () => ({
  default: {
    get __loaded() {
      return posthogState.loaded;
    },
    onFeatureFlags: onFeatureFlagsMock,
    isFeatureEnabled: isFeatureEnabledMock,
    reloadFeatureFlags: reloadFeatureFlagsMock,
  },
}));

import { FeatureFlagProvider, useFeatureFlag } from '../FeatureFlagProvider';
import { FeatureFlagRoute } from '../FeatureFlagRoute';

function FlagProbe() {
  const enabled = useFeatureFlag('AI_AGENT');
  return <div>{enabled ? 'enabled' : 'disabled'}</div>;
}

describe('FeatureFlagProvider', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    posthogState.loaded = false;
    posthogState.flags = {};
    posthogState.listener = null;
    onFeatureFlagsMock.mockClear();
    isFeatureEnabledMock.mockClear();
    reloadFeatureFlagsMock.mockClear();
  });

  it('updates when PostHog finishes loading after mount', async () => {
    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    expect(screen.getByText('enabled')).toBeInTheDocument();
    expect(onFeatureFlagsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      posthogState.flags.ff_ai_agent = false;
      posthogState.loaded = true;
      posthogState.listener?.();
    });

    await waitFor(() => {
      expect(screen.getByText('disabled')).toBeInTheDocument();
    });
  });

  it('applies dev overrides from localStorage', async () => {
    localStorage.setItem('shipsec_feature_flags_override', JSON.stringify({ AI_AGENT: false }));

    render(
      <FeatureFlagProvider>
        <FlagProbe />
      </FeatureFlagProvider>,
    );

    await waitFor(() => {
      expect(screen.getByText('disabled')).toBeInTheDocument();
    });
  });

  it('redirects guarded routes when a dev override disables the flag', async () => {
    localStorage.setItem('shipsec_feature_flags_override', JSON.stringify({ AI_AGENT: false }));

    render(
      <MemoryRouter initialEntries={['/chat']}>
        <FeatureFlagProvider>
          <Routes>
            <Route path="/" element={<div>home</div>} />
            <Route element={<FeatureFlagRoute flag="AI_AGENT" />}>
              <Route path="/chat" element={<div>chat</div>} />
            </Route>
          </Routes>
        </FeatureFlagProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('home')).toBeInTheDocument();
    });

    expect(screen.queryByText('chat')).not.toBeInTheDocument();
  });
});
