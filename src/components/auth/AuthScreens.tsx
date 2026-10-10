/**
 * CONSOL Authentication Screens
 * Renders Booting, Offline, Setup, Sign-in, and Staff Authorisation views.
 * Preserves the exact visual hierarchy, form fields, and error messaging from ProvenanceOS.
 */

import React, { useState } from 'react';
import config from '../../config';
import { useAuth } from '../../context/AuthContext';

export const BrandHeader: React.FC = () => (
  <div className="brand">
    <img src={config.APP_LOGO} alt="Australian Provenance Project" />
    <div className="system">
      <img src={config.SYS_LOGO} alt="" />
      <span>ProvenanceOS</span>
    </div>
  </div>
);

export const BootingScreen: React.FC = () => (
  <div className="auth">
    <section className="card auth-card">
      <BrandHeader />
      <div className="sub" role="status">Connecting…</div>
    </section>
  </div>
);

export const OfflineScreen: React.FC = () => {
  const { retryBoot, errorMessage } = useAuth();
  return (
    <div className="auth">
      <section className="card auth-card">
        <BrandHeader />
        <div className="eyebrow">Can’t start</div>
        <h1 className="title auth-title">Connection problem</h1>
        <div className="sub">
          {errorMessage || 'Can’t reach Supabase. Check your signal and try again.'}
        </div>
        <div className="actions">
          <button className="primary" onClick={() => void retryBoot()}>
            Try again
          </button>
        </div>
      </section>
    </div>
  );
};

export const SetupScreen: React.FC = () => {
  const { retryBoot } = useAuth();
  return (
    <div className="auth">
      <section className="card auth-card">
        <BrandHeader />
        <div className="eyebrow">One-time setup</div>
        <h1 className="title auth-title">Database not set up yet</h1>
        <div className="sub">Your Supabase project is connected but has no ProvenanceOS tables.</div>
        <ol className="steps">
          <li>In Supabase, open <b>Authentication → Users</b> and add your user (tick <i>Auto Confirm User</i>).</li>
          <li>Open <b>SQL Editor → New query</b>, paste the contents of <b>supabase/schema.sql</b> from this project, and press <b>Run</b>.</li>
          <li>Come back here and press the button below.</li>
        </ol>
        <div className="actions">
          <button className="primary" onClick={() => void retryBoot()}>
            I’ve run it — check again
          </button>
        </div>
      </section>
    </div>
  );
};

export const LoginScreen: React.FC = () => {
  const { signIn, errorMessage } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setLocalError('Enter your email and password.');
      return;
    }

    setLocalError(null);
    setLoading(true);

    try {
      const res = await signIn(cleanEmail, password);
      if (!res.success && res.error) {
        setLocalError(res.error);
      }
    } finally {
      setLoading(false);
    }
  };

  const displayedError = localError || errorMessage;

  return (
    <div className="auth">
      <section className="card auth-card">
        <BrandHeader />
        <div className="eyebrow">Australian Provenance Project</div>
        <h1 className="title auth-title">Sign in</h1>
        <div className="sub">Use the account your administrator created for you.</div>

        <form onSubmit={handleSubmit} className="login" noValidate>
          <div className="fields">
            <div className="field">
              <label htmlFor="login-email">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="login-password">Password</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            </div>
          </div>

          {displayedError && (
            <div className="form-error" role="alert">
              {displayedError}
            </div>
          )}

          <div className="actions">
            <button className="primary" type="submit" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
};

export const PendingScreen: React.FC = () => {
  const { user, signOut, retryBoot } = useAuth();
  return (
    <div className="auth">
      <section className="card auth-card">
        <BrandHeader />
        <div className="eyebrow">Almost there</div>
        <h1 className="title auth-title">Access not granted yet</h1>
        <div className="sub">
          You’re signed in as <b>{user?.email || 'authenticated user'}</b>, but this account isn’t on the staff list. Ask an administrator to authorise it, then try again.
        </div>
        <div className="actions">
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
          <button className="primary" onClick={() => void retryBoot()}>
            Check again
          </button>
        </div>
      </section>
    </div>
  );
};
