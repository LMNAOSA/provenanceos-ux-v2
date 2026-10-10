/**
 * CONSOL Four-Pillar Module Directory (#/modules)
 * Exposes the complete typed MODULE_REGISTRY across COLLECTION, SCIENCE, VISUALISATION, and WORKSPACE.
 *
 * Directive v3.2 Compliance:
 * - Availability reflects actual functionality ('operational', 'research-stage', 'planned').
 * - Planned future modules (SOLVE, SOLOPTICS, SOLID, EXCAVATE, OPN Registry, IP & Discovery, Funding Studio)
 *   are documented transparently here with their required capabilities and specimen-context dependencies,
 *   without placing dead placeholder links in the primary navigation rail.
 */

import React from 'react';
import { useApp } from '../../context/AppContext';
import { TopHeader } from '../layout/TopHeader';
import { PILLARS, MODULE_REGISTRY } from '../../types/routes';

export const ModuleDirectoryView: React.FC = () => {
  const { navigate, activeSpecimenId } = useApp();

  return (
    <div className="module-directory-view">
      <TopHeader
        eyebrow="CONSOL Architecture v3.2"
        title="Four-Pillar Module Registry"
        sub="Authoritative system map of operational modules, active research stages, and gated future infrastructure."
        action={
          <button
            type="button"
            className="secondary"
            onClick={() => navigate('#/home')}
          >
            ← Back to Workbench
          </button>
        }
      />

      <div className="directory-pillars-stack">
        {PILLARS.map(pillar => {
          const modules = MODULE_REGISTRY.filter(m => m.pillar === pillar.id);

          return (
            <section key={pillar.id} className="surface directory-pillar-block">
              <div className="surface-head">
                <div>
                  <span className="eyebrow">{pillar.label}</span>
                  <h3>{pillar.subtitle}</h3>
                  <p style={{ color: 'var(--muted)', fontSize: 13, marginTop: 4 }}>
                    {pillar.description}
                  </p>
                </div>
              </div>

              <div className="directory-modules-grid">
                {modules.map(mod => {
                  const isNavigable = mod.route !== null && mod.availability !== 'planned';

                  return (
                    <article
                      key={mod.id}
                      className={`directory-module-card state-${mod.availability}`}
                    >
                      <div className="directory-module-top">
                        <strong>{mod.label}</strong>
                        <span className={`availability-label state-${mod.availability}`}>
                          {mod.availability === 'operational'
                            ? 'Operational'
                            : mod.availability === 'research-stage'
                              ? 'UX-02 Active'
                              : 'Planned Architecture'}
                        </span>
                      </div>

                      <p className="directory-module-desc">{mod.description}</p>

                      {mod.scientificNote && (
                        <p className="directory-module-note">{mod.scientificNote}</p>
                      )}

                      <div className="directory-module-meta">
                        <span>Capability: {mod.requiredCapability}</span>
                        <span>·</span>
                        <span>Specimen Context: {mod.specimenContextDependency}</span>
                      </div>

                      {isNavigable && mod.hash && (
                        <div className="directory-module-action">
                          <button
                            type="button"
                            className="secondary"
                            style={{ padding: '7px 14px', fontSize: 12 }}
                            onClick={() => {
                              if (mod.route === 'solarium' && activeSpecimenId) {
                                navigate(`#/solarium/${encodeURIComponent(activeSpecimenId)}`);
                              } else if (mod.route === 'the-lab' && activeSpecimenId) {
                                navigate(`#/the-lab/${encodeURIComponent(activeSpecimenId)}`);
                              } else if (mod.hash) {
                                navigate(mod.hash);
                              }
                            }}
                          >
                            Open {mod.label} →
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
};

export default ModuleDirectoryView;
