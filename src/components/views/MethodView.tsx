/**
 * CONSOL MethodView Component
 * Interactive field guide documenting the 5-step specimen acquisition protocol.
 * Includes direct PDF field guide download and protocol discipline warnings.
 */

import React from 'react';
import { TopHeader } from '../layout/TopHeader';

export const MethodView: React.FC = () => {
  return (
    <>
      <TopHeader
        eyebrow="Field method"
        title="ProvenanceOS™ method"
        sub="The operating record for specimen capture, pXRF handling and evidence discipline."
        action={
          <a
            className="method-download"
            href="field-guide.pdf"
            download="ProvenanceOS_Field_Guide_Mat.pdf"
            aria-label="Download ProvenanceOS Field Guide"
          >
            <span>DOWNLOAD</span>
            <span>FIELD GUIDE</span>
          </a>
        }
      />

      <section className="surface method-flow">
        <div className="method-flow-intro">
          <div className="eyebrow">FIELD WORKFLOW</div>
          <h2>Field workflow</h2>
          <p>One specimen. One record. Capture everything as you go.</p>
        </div>

        <div className="method-steps">
          {/* STEP 1 */}
          <article className="method-step">
            <div className="method-step-number">01</div>
            <div className="method-step-icon">+</div>
            <div className="method-step-content">
              <div className="method-step-label">REGISTER</div>
              <h3>Start the specimen record</h3>
              <p>Choose the material class:</p>
              <div className="method-pills">
                <span>AHM</span>
                <span>ACC</span>
                <span>ACX</span>
                <span>OTH</span>
              </div>
            </div>
            <div className="method-step-note">The system creates the ID.</div>
          </article>

          <div className="method-arrow">↓</div>

          {/* STEP 2 */}
          <article className="method-step">
            <div className="method-step-number">02</div>
            <div className="method-step-icon">⌾</div>
            <div className="method-step-content">
              <div className="method-step-label">CAPTURE</div>
              <h3>Shoot the specimen</h3>
              <p>Capture the evidence while you have the specimen in front of you.</p>
              <div className="method-pills">
                <span>VISIBLE</span>
                <span>UV</span>
                <span>AFTERGLOW</span>
              </div>
            </div>
            <div className="method-step-note">Original evidence is preserved.</div>
          </article>

          <div className="method-arrow">↓</div>

          {/* STEP 3 */}
          <article className="method-step">
            <div className="method-step-number">03</div>
            <div className="method-step-icon">⌁</div>
            <div className="method-step-content">
              <div className="method-step-label">MEASURE</div>
              <h3>Record dimensions</h3>
              <p>Use a known reference in the same image plane for a 2D estimate.</p>
              <div className="method-pills">
                <span>REFERENCE</span>
                <span>2D ESTIMATE</span>
              </div>
            </div>
            <div className="method-step-note">No guessed thickness.</div>
          </article>

          <div className="method-arrow">↓</div>

          {/* STEP 4 */}
          <article className="method-step">
            <div className="method-step-number">04</div>
            <div className="method-step-icon">◈</div>
            <div className="method-step-content">
              <div className="method-step-label">XRF</div>
              <h3>Attach the Vanta result</h3>
              <p>Export the Vanta data and attach readings using the exact specimen ID.</p>
              <div className="method-pills">
                <span>CSV</span>
                <span>EXACT ID</span>
              </div>
            </div>
            <div className="method-step-note">Batch import. No one-reading-at-a-time workflow.</div>
          </article>

          <div className="method-arrow">↓</div>

          {/* STEP 5 */}
          <article className="method-step method-step-complete">
            <div className="method-step-number">05</div>
            <div className="method-step-icon">✓</div>
            <div className="method-step-content">
              <div className="method-step-label">COMPLETE</div>
              <h3>Review and move on</h3>
              <p>Check that the specimen, evidence and measurements belong together.</p>
              <div className="method-pills">
                <span>REVIEW</span>
                <span>PRESERVED</span>
              </div>
            </div>
            <div className="method-step-note">Then move to the next specimen.</div>
          </article>
        </div>

        {/* Warning Checklist */}
        <section className="method-warning" style={{ padding: 26, borderTop: '1px solid var(--line)' }}>
          <div className="method-warning-head" style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 16 }}>
            <div className="method-warning-icon" style={{ fontSize: 24, color: 'var(--gold)' }}>!</div>
            <div>
              <div className="method-step-label">IF SOMETHING DOESN&#39;T MATCH</div>
              <h3 style={{ margin: '4px 0 0', fontWeight: 300, fontSize: 22 }}>Stop. Check. Don&#39;t guess.</h3>
              <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                It is better to pause than to create a record that cannot be trusted.
              </p>
            </div>
          </div>
          <div className="method-warning-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
            <div className="method-warning-item card pad" style={{ background: 'rgba(0,0,0,0.2)' }}>
              <strong>01</strong>
              <div style={{ marginTop: 6 }}>
                <b>STOP &amp; REVIEW</b>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Check the specimen, photos, ID and measurements.</p>
              </div>
            </div>
            <div className="method-warning-item card pad" style={{ background: 'rgba(0,0,0,0.2)' }}>
              <strong>02</strong>
              <div style={{ marginTop: 6 }}>
                <b>DO NOT GUESS</b>
                <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12 }}>Never invent an ID or change a result to make it fit.</p>
              </div>
            </div>
          </div>
        </section>
      </section>
    </>
  );
};

export default MethodView;
