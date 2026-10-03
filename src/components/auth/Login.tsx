import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { CircleAlert } from 'lucide-react';
import loopIcon from '@/assets/loopIcon.png';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/field';

export function Login() {
  const { login, loginViewer, isAuthenticated, isLoading, error, clearError } = useAuthStore();
  const [netid, setNetid] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) return <Navigate to="/" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login({ username: netid, password });
    } catch {
      // error is in the store
    }
  };

  const handleViewOnly = async () => {
    clearError();
    try {
      await loginViewer();
    } catch {
      // error is in the store
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-black">
      <div className="flex items-center gap-2.5 px-7 py-5">
        <img src={loopIcon} alt="" className="size-[30px] object-contain" />
        <span className="text-base font-extrabold tracking-[-0.02em]">Hub Manager</span>
      </div>

      <div className="flex flex-1 justify-center px-6 pt-[9vh] pb-12">
        <form onSubmit={handleSubmit} className="w-full max-w-[400px]">
          <h1 className="display">Sign in</h1>
          <p className="mt-3 mb-9 text-base leading-6 text-fg-2">Use your NetID and the team password.</p>

          <Field label="NetID">
            <TextInput
              id="netid"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="e.g. abc123"
              value={netid}
              onChange={(e) => setNetid(e.target.value)}
              disabled={isLoading}
              className="h-[52px] text-base"
              required
            />
          </Field>
          <div className="mt-5">
            <Field label="Team password">
              <TextInput
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Team password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="h-[52px] text-base"
                required
              />
            </Field>
          </div>

          {error && (
            <div className="mt-3.5 flex items-center gap-2 text-sm text-brand-ink">
              <CircleAlert size={16} />
              <span>{error}</span>
            </div>
          )}

          <Button type="submit" variant="primary" size="xl" className="mt-7 w-full text-base" disabled={isLoading}>
            {isLoading ? 'Signing in…' : 'Sign in'}
          </Button>

          <div className="my-[22px] flex items-center gap-3 text-[13px] text-fg-3">
            <span className="h-px flex-1 bg-line" />
            or
            <span className="h-px flex-1 bg-line" />
          </div>

          <Button type="button" size="xl" className="w-full text-base" onClick={handleViewOnly} disabled={isLoading}>
            {isLoading ? 'Loading…' : 'Continue in view-only mode'}
          </Button>
          <p className="mt-3.5 text-[13px] leading-5 text-fg-3">View-only opens every page but can't write, restart, close or flash.</p>
        </form>
      </div>
    </div>
  );
}
