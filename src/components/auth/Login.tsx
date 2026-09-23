import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function Login() {
  const { login, loginViewer, isAuthenticated, isLoading, error, clearError } = useAuthStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();

    try {
      await login({ username, password });
    } catch {
      // Error is handled by the store
    }
  };

  const handleViewOnly = async () => {
    clearError();
    try {
      await loginViewer();
    } catch {
      // Error is handled by the store
    }
  };

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-primary/10 p-4">
      <Card className="w-full max-w-md shadow-xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold">Sign in</CardTitle>
          <CardDescription>
            Sign in with your NetID and the team password
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">NetID</Label>
              <Input
                id="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="e.g. abc123"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Team password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Team password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
            {error && (
              <div className="p-3 text-sm text-destructive-foreground bg-destructive/10 border border-destructive/20 rounded-md">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 pt-6 border-t space-y-3">
            <p className="text-sm text-muted-foreground text-center">Or</p>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleViewOnly}
              disabled={isLoading}
            >
              {isLoading ? 'Loading...' : 'View Only Mode'}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              View-only mode shows every page but cannot send commands (write, restart, close, flash)
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
