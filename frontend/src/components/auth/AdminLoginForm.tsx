import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/authStore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LockKeyhole, LogIn } from 'lucide-react';
import { api } from '@/services/api';

export function AdminLoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const setAdminCredentials = useAuthStore((state) => state.setAdminCredentials);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    // Validate inputs
    if (!trimmedUsername || !trimmedPassword) {
      setError('Please enter both username and password');
      return;
    }

    setIsLoading(true);

    try {
      // Validate credentials and set session cookie via /auth/login endpoint
      // This sets an httpOnly cookie for browser navigation to protected routes (e.g., /analytics/)
      const credentials = btoa(`${trimmedUsername}:${trimmedPassword}`);
      await api.auth.login(`Basic ${credentials}`);

      // Store credentials for API requests (Basic auth header)
      setAdminCredentials(trimmedUsername, trimmedPassword);

      // Success - redirect to returnTo URL or home
      if (returnTo) {
        // For paths like /analytics/*, use full page navigation since they're served by nginx
        if (returnTo.startsWith('/analytics')) {
          window.location.href = returnTo;
        } else {
          navigate(returnTo);
        }
      } else {
        navigate('/');
      }
    } catch (err) {
      // Clear credentials on error
      useAuthStore.getState().clear();
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100dvh-3.25rem)] items-center justify-center bg-background p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border bg-card shadow-[0_1px_2px_rgba(15,15,15,0.04),0_18px_60px_-44px_hsl(var(--primary)/0.55)] md:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="hidden border-r bg-muted/30 p-8 md:flex md:flex-col md:justify-between">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg border bg-background">
            <LockKeyhole className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              ShipSec local
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Secure workspace access</h1>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              Sign in to continue managing security automation, findings, integrations, and workflow
              execution.
            </p>
          </div>
        </div>

        <div className="space-y-6 p-6 md:p-8">
          <div className="space-y-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border bg-muted/70 md:hidden">
              <LockKeyhole className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Admin login</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Enter your local admin credentials to continue.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                required
                autoFocus
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Logging in...' : 'Login'}
              <LogIn className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
