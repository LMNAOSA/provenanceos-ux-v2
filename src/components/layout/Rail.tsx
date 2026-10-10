/**
 * CONSOL Icon-Led Scientific Workstation Rail
 * UX Reset Step 4 + Navigation Design Addendum
 *
 * Visual & Functional Specification:
 * - Fine-line Lucide-style SVG icons (18px, 1.65px stroke, consistent optical alignment)
 * - No icons on nested module rows
 * - Target desktop width: 232px (compact icon-only mode: 64px)
 * - One pillar expanded at a time by default
 * - Required destinations:
 *   • Workbench (House icon)
 *   • Collection (Archive icon): Specimens, XRF Inbox, Evidence, Reference Data, Field Method
 *   • Science (Flask icon): Investigations (The Lab)
 *   • Visualisation (Precision scan icon): SOLARIUM
 *   • Workspace (Connected-nodes icon): Provenance
 *   • Settings (Settings icon, pinned to bottom)
 * - Mobile: Five-destination navigation bar (Workbench + 4 pillars) with contextual module strip
 */

import React from 'react';
import config from '../../config';
import { PILLARS, PillarId, getNavigableModulesByPillar } from '../../types/routes';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';

const IconHouse: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 10.5L12 3l9 7.5" />
    <path d="M5 9.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9.5" />
    <path d="M9 21v-6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v6" />
  </svg>
);

const IconCollection: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2" y="4" width="20" height="5" rx="1" />
    <path d="M4 9v9a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9" />
    <path d="M10 13h4" />
  </svg>
);

const IconFlask: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10 2v6.292a4 4 0 0 1-.672 2.219l-4.656 6.984A2 2 0 0 0 6.336 20.6h11.328a2 2 0 0 0 1.664-3.105l-4.656-6.984A4 4 0 0 1 14 8.292V2" />
    <path d="M8.5 2h7" />
    <path d="M7 15h10" />
  </svg>
);

const IconScan: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7V5a2 2 0 0 1 2-2h2" />
    <path d="M17 3h2a2 2 0 0 1 2 2v2" />
    <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
    <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
    <polygon points="12 7 17 12 12 17 7 12 12 7" />
  </svg>
);

const IconNodes: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="12" cy="18" r="2.5" />
    <path d="M8.5 6h7" />
    <path d="M7.2 8.2l3.6 7.6" />
    <path d="M16.8 8.2l-3.6 7.6" />
  </svg>
);

const IconSettings: React.FC = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconChevron: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.16s cubic-bezier(0.16, 1, 0.3, 1)'
    }}
  >
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const IconPanelCollapse: React.FC<{ collapsed: boolean }> = ({ collapsed }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18" />
    {collapsed ? <path d="M13 9l3 3-3 3" /> : <path d="M15 9l-3 3 3 3" />}
  </svg>
);

function renderPillarIcon(pillar: PillarId) {
  switch (pillar) {
    case 'COLLECTION':
      return <IconCollection />;
    case 'SCIENCE':
      return <IconFlask />;
    case 'VISUALISATION':
      return <IconScan />;
    case 'WORKSPACE':
      return <IconNodes />;
  }
}

export const Rail: React.FC = () => {
  const {
    route,
    activeSpecimenId,
    setActiveSpecimenId,
    activePillar,
    expandedPillars,
    togglePillar,
    railCollapsed,
    setRailCollapsed,
    navigate
  } = useApp();
  const { user } = useAuth();

  const activeRouteKey = route === 'sample' ? 'samples' : route;

  const handleModuleClick = (moduleRoute: string, hash: string | null) => {
    if (!hash) return;
    if (moduleRoute === 'solarium' && activeSpecimenId) {
      navigate(`#/solarium/${encodeURIComponent(activeSpecimenId)}`);
      return;
    }
    navigate(hash);
  };

  const handlePillarHeaderClick = (pillarId: PillarId) => {
    const modules = getNavigableModulesByPillar(pillarId);
    if (railCollapsed) {
      // In icon-only mode, clicking a pillar navigates directly to its primary module
      const primary = modules[0];
      if (primary?.hash) {
        handleModuleClick(primary.route || '', primary.hash);
      }
      return;
    }

    // If pillar has only 1 working destination and is not expanded yet, expand and navigate
    if (modules.length === 1 && !expandedPillars[pillarId]) {
      togglePillar(pillarId);
      handleModuleClick(modules[0].route || '', modules[0].hash);
      return;
    }

    togglePillar(pillarId);
  };

  // Determine which pillar's modules to display in the mobile contextual sub-bar
  const mobileContextualPillar: PillarId | null =
    activePillar ||
    (Object.keys(expandedPillars) as PillarId[]).find(k => expandedPillars[k]) ||
    null;

  const mobileContextModules = mobileContextualPillar
    ? getNavigableModulesByPillar(mobileContextualPillar)
    : [];

  return (
    <aside
      className={`rail pillar-rail ${railCollapsed ? 'is-collapsed' : ''}`}
      aria-label="CONSOL Navigation"
    >
      {/* Top Brand & Compact Icon-Only Toggle */}
      <div className="rail-head">
        <div className="brand">
          {!railCollapsed && (
            <img src={config.APP_LOGO} alt="Australian Provenance Project" />
          )}
        </div>
        <button
          type="button"
          className="rail-collapse-btn"
          onClick={() => setRailCollapsed(!railCollapsed)}
          aria-label={railCollapsed ? 'Expand navigation rail' : 'Collapse navigation rail'}
          title={railCollapsed ? 'Expand navigation rail' : 'Compact icon-only rail'}
        >
          <IconPanelCollapse collapsed={railCollapsed} />
        </button>
      </div>

      {/* Persistent Active Specimen Context */}
      {activeSpecimenId && !railCollapsed && (
        <div className="rail-specimen-context" role="region" aria-label="Active specimen context">
          <div className="rail-specimen-head">
            <span className="rail-specimen-kicker">Active Specimen</span>
            <button
              type="button"
              className="rail-specimen-clear"
              onClick={() => setActiveSpecimenId(null)}
              title="Clear active specimen"
              aria-label="Clear active specimen"
            >
              ×
            </button>
          </div>
          <div className="rail-specimen-id">{activeSpecimenId}</div>
          <div className="rail-specimen-actions">
            <button
              type="button"
              className={route === 'sample' ? 'active' : ''}
              onClick={() => navigate(`#/samples/${encodeURIComponent(activeSpecimenId)}`)}
            >
              Record
            </button>
            <button
              type="button"
              className={route === 'solarium' ? 'active' : ''}
              onClick={() => navigate(`#/solarium/${encodeURIComponent(activeSpecimenId)}`)}
            >
              SOLARIUM
            </button>
            <button
              type="button"
              className={route === 'the-lab' ? 'active' : ''}
              onClick={() => navigate('#/the-lab')}
            >
              Investigate
            </button>
          </div>
        </div>
      )}

      {/* Desktop / Tablet Primary Navigation */}
      <nav className="pillar-nav desktop-pillar-nav" aria-label="Primary">
        {/* Workbench Entry */}
        <button
          type="button"
          className={`rail-item-btn workbench-btn ${route === 'home' ? 'is-active' : ''}`}
          aria-current={route === 'home' ? 'page' : undefined}
          onClick={() => navigate('#/home')}
          title="Workbench"
        >
          <span className="rail-icon">
            <IconHouse />
          </span>
          {!railCollapsed && <span className="rail-label">Workbench</span>}
        </button>

        <div className="rail-divider" role="separator" />

        {/* Four Expandable Pillars */}
        <div className="pillar-groups">
          {PILLARS.map(pillar => {
            const isPillarActive = activePillar === pillar.id;
            const isExpanded = expandedPillars[pillar.id];
            const modules = getNavigableModulesByPillar(pillar.id);

            return (
              <div
                key={pillar.id}
                className={`pillar-group ${isPillarActive ? 'is-active-pillar' : ''} ${isExpanded ? 'is-expanded' : ''}`}
              >
                <button
                  type="button"
                  className={`rail-item-btn pillar-trigger ${isPillarActive ? 'is-active' : ''}`}
                  aria-expanded={!railCollapsed ? isExpanded : undefined}
                  onClick={() => handlePillarHeaderClick(pillar.id)}
                  title={pillar.label}
                >
                  <span className="rail-icon">{renderPillarIcon(pillar.id)}</span>
                  {!railCollapsed && (
                    <>
                      <span className="rail-label">{pillar.label}</span>
                      <span className="rail-chevron">
                        <IconChevron expanded={isExpanded} />
                      </span>
                    </>
                  )}
                </button>

                {!railCollapsed && isExpanded && (
                  <div className="pillar-modules" role="group" aria-label={`${pillar.label} destinations`}>
                    {modules.map(mod => {
                      const isModActive = mod.route === activeRouteKey;
                      return (
                        <button
                          key={mod.id}
                          type="button"
                          className={`pillar-module-btn ${isModActive ? 'is-active' : ''}`}
                          aria-current={isModActive ? 'page' : undefined}
                          onClick={() => handleModuleClick(mod.route || '', mod.hash)}
                        >
                          <span className="module-name">{mod.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </nav>

      {/* Mobile 5-Destination Navigation Bar (Workbench + 4 Pillars) */}
      <nav className="mobile-five-nav" aria-label="Mobile Primary">
        <div className="mobile-five-row">
          <button
            type="button"
            className={`mobile-dest-btn ${route === 'home' ? 'is-active' : ''}`}
            onClick={() => navigate('#/home')}
          >
            <IconHouse />
            <span>Workbench</span>
          </button>

          {PILLARS.map(pillar => {
            const isPillarSelected = activePillar === pillar.id || (route === 'home' && expandedPillars[pillar.id]);
            const modules = getNavigableModulesByPillar(pillar.id);
            return (
              <button
                key={pillar.id}
                type="button"
                className={`mobile-dest-btn ${activePillar === pillar.id ? 'is-active' : ''}`}
                aria-expanded={isPillarSelected}
                onClick={() => {
                  togglePillar(pillar.id);
                  if (modules.length === 1 && modules[0].hash) {
                    handleModuleClick(modules[0].route || '', modules[0].hash);
                  } else if (activePillar !== pillar.id && modules[0]?.hash) {
                    handleModuleClick(modules[0].route || '', modules[0].hash);
                  }
                }}
              >
                {renderPillarIcon(pillar.id)}
                <span>{pillar.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            className={`mobile-dest-btn ${route === 'settings' ? 'is-active' : ''}`}
            onClick={() => navigate('#/settings')}
            aria-label="Settings"
          >
            <IconSettings />
            <span>Settings</span>
          </button>
        </div>

        {/* Contextual Module Strip on Mobile when active pillar has working destinations */}
        {route !== 'home' && route !== 'settings' && mobileContextModules.length > 0 && (
          <div className="mobile-context-modules" role="group" aria-label="Module navigation">
            {mobileContextModules.map(mod => {
              const isModActive = mod.route === activeRouteKey;
              return (
                <button
                  key={mod.id}
                  type="button"
                  className={`mobile-module-chip ${isModActive ? 'is-active' : ''}`}
                  onClick={() => handleModuleClick(mod.route || '', mod.hash)}
                >
                  {mod.label}
                </button>
              );
            })}
          </div>
        )}
      </nav>

      {/* Bottom Pinned Settings */}
      <div className="rail-footer">
        <button
          type="button"
          className={`rail-item-btn settings-btn ${route === 'settings' ? 'is-active' : ''}`}
          aria-current={route === 'settings' ? 'page' : undefined}
          onClick={() => navigate('#/settings')}
          title="Settings"
        >
          <span className="rail-icon">
            <IconSettings />
          </span>
          {!railCollapsed && (
            <span className="rail-account-copy">
              <span className="rail-label">Settings</span>
              {user?.email && <small>{user.email}</small>}
            </span>
          )}
        </button>
      </div>
    </aside>
  );
};
