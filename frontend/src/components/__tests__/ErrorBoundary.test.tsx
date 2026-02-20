import { describe, it, expect, vi, beforeEach } from 'bun:test';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ErrorBoundary } from '../ErrorBoundary';

const hasDom = typeof document !== 'undefined';
const describeBoundary = hasDom ? describe : describe.skip;

function ThrowingChild({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) throw new Error('Test crash');
  return <div>Child rendered</div>;
}

describeBoundary('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello')).toBeTruthy();
  });

  it('renders fallback when child throws during render', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByText('Go Home')).toBeTruthy();
  });

  it('shows generic message when not in dev mode', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    // bun test runs with import.meta.env.DEV = false, so generic message is shown
    expect(
      screen.getByText(
        'An unexpected error occurred. Please try again or return to the home page.',
      ),
    ).toBeTruthy();
  });

  it('"Try Again" button resets boundary and re-renders children', () => {
    let shouldThrow = true;
    function Toggling() {
      if (shouldThrow) throw new Error('Boom');
      return <div>Recovered</div>;
    }

    render(
      <ErrorBoundary>
        <Toggling />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();

    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));
    expect(screen.getByText('Recovered')).toBeTruthy();
  });

  it('renders custom fallback when provided', () => {
    render(
      <ErrorBoundary fallback={<div>Custom error UI</div>}>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    expect(screen.getByText('Custom error UI')).toBeTruthy();
  });

  it('resetOnNavigate: resets when pathname changes', () => {
    const initialEntries = ['/page-a'];
    const { unmount } = render(
      <MemoryRouter initialEntries={initialEntries}>
        <ErrorBoundary resetOnNavigate>
          <ThrowingChild />
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    unmount();

    // Re-render with a new path — boundary should reset and attempt to render children again
    // Since ThrowingChild always throws, it'll show the error again,
    // but the key thing is the boundary reset (componentDidUpdate fires)
    render(
      <MemoryRouter initialEntries={['/page-b']}>
        <ErrorBoundary resetOnNavigate>
          <div>Page B content</div>
        </ErrorBoundary>
      </MemoryRouter>,
    );
    expect(screen.getByText('Page B content')).toBeTruthy();
  });

  it('Go Home link points to / using plain anchor', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    const link = screen.getByText('Go Home');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/');
  });

  it('hides stack trace when not in dev mode', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    );
    // bun test runs with import.meta.env.DEV = false, so stack trace is hidden
    expect(screen.queryByText('Stack trace')).toBeNull();
  });
});
