/**
 * CONSOL SettingsView Component
 * System and connection diagnostics, parser versions, and runtime configuration.
 */

import React from 'react';
import { TopHeader } from '../layout/TopHeader';
import { useAuth } from '../../context/AuthContext';
import config from '../../config';

export const SettingsView: React.FC = () => {
  const { user, signOut } = useAuth();

  let host = config.SUPABASE_URL || '';
  try {
    host = new URL(host).host;
  } catch {
    // ignore
  }

  return (
    <>
      <TopHeader
        eyebrow="ProvenanceOS"
        title="Settings"
        sub="The instrument and evidence registry are append-only by design."
      />

      <section className="surface settings">
        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Signed in</span>
          <p style={{ marginTop: 4, fontSize: 16 }}>{user?.email || 'Authenticated user'}</p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Database Connection</span>
          <p style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 14 }}>{host}</p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Parser Engine</span>
          <p style={{ marginTop: 4, fontSize: 14 }}>{config.PARSER_VERSION}</p>
        </div>

        <div style={{ marginBottom: 18 }}>
          <span className="eyebrow">Evidence Architecture</span>
          <p style={{ marginTop: 4, fontSize: 14 }}>Originals + SHA-256 Hashes + Non-destructive Derived Lineage</p>
        </div>

        <div style={{ marginBottom: 24, padding: '14px 16px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--line)' }}>
          <span className="eyebrow">Runtime Architecture</span>
          <p style={{ marginTop: 4, fontSize: 14, color: 'var(--text)' }}>
            React 19 Native Shell (Stage 4 Active)
          </p>
          <small style={{ color: 'var(--muted)', display: 'block', marginTop: 6, lineHeight: 1.5 }}>
            To verify the operational field acquisition and batch ingestion tools via the isolated legacy recovery mode:{' '}
            <a href="?runtime=legacy#/home" style={{ color: 'var(--aqua)', textDecoration: 'underline' }}>
              Switch to legacy operational mode
            </a>.
          </small>
        </div>

        <div className="actions">
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </section>
    </>
  );
};

export default SettingsView;
