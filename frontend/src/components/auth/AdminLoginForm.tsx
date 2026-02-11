import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuthStore } from '@/store/authStore';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LogIn } from 'lucide-react';

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
      // Use relative path to ensure cookie is set via nginx (same origin as /analytics/* routes)
      const credentials = btoa(`${trimmedUsername}:${trimmedPassword}`);
      const loginResponse = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Important: include cookies in the response
      });

      if (!loginResponse.ok) {
        if (loginResponse.status === 401) {
          throw new Error('Invalid username or password');
        }
        throw new Error(
          `Authentication failed: ${loginResponse.status} ${loginResponse.statusText}`,
        );
      }

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
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-8 shadow-lg">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold">Admin Login</h1>
          <p className="text-sm text-muted-foreground">Enter your admin credentials to continue</p>
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
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            <LogIn className="mr-2 h-4 w-4" />
            {isLoading ? 'Logging in...' : 'Login'}
          </Button>
        </form>
      </div>
    </div>
  );
}
