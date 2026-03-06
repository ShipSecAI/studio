import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

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

function FlagProbe() {
  const enabled = useFeatureFlag('AI_AGENT');
  return <div>{enabled ? 'enabled' : 'disabled'}</div>;
}

describe('FeatureFlagProvider', () => {
  beforeEach(() => {
    cleanup();
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
});
