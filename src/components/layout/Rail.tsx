/**
 * CONSOL Adaptive Scientific Workstation Rail (BUILD 01)
 * Version 3.3 — Normal Workstation Mode, SOLARIUM Instrument Mode & Mobile Drawer
 *
 * Modes:
 * 1. Normal Workstation Mode (232px desktop):
 *    - CONSOL branding at the top
 *    - Workbench + 4 pillars (Collection, Science, Visualisation, Workspace)
 *    - Working modules nested beneath each pillar
 *    - Settings anchored to the bottom
 * 2. Instrument Mode (60px desktop, auto-activated on #/solarium):
 *    - Compact 60px icon rail freeing horizontal viewport width for the 3D chamber
 *    - Accessible pillar icons with tooltips and active SOLARIUM indicator
 *    - Explicit "Expand Navigation" / "Collapse Navigation" control
 * 3. Mobile Compact Navigation:
 *    - Purposeful top bar with on-demand pillar/module menu drawer (never permanently obstructing 3D viewport)
 */

import React from 'react';
import config from '../../config';
import { PILLARS, PillarId, APP_ROUTES, getNavigableModulesByPillar } from '../../types/routes';
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
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82-.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

const IconMenu: React.FC<{ open: boolean }> = ({ open }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {open ? (
      <>
        <path d="M18 6L6 18" />
        <path d="M6 6l12 12" />
      </>
    ) : (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
      </>
    )}
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
    navigationMode,
    railCollapsed,
    setRailCollapsed,
    mobileNavOpen,
    setMobileNavOpen,
    navigate
  } = useApp();
  const { user } = useAuth();

  const activeRouteKey = route === 'sample' ? 'samples' : route;
  const currentRouteMeta = APP_ROUTES.find(r => r.id === activeRouteKey);
  const currentSectionTitle = currentRouteMeta?.name || 'CONSOL';

  const handleModuleClick = (moduleRoute: string, hash: string | null) => {
    if (!hash) return;
    setMobileNavOpen(false);
    if ((moduleRoute === 'solarium' || moduleRoute === 'soloptics') && activeSpecimenId) {
      navigate(`#/${moduleRoute}/${encodeURIComponent(activeSpecimenId)}`);
      return;
    }
    navigate(hash);
  };

  const handlePillarHeaderClick = (pillarId: PillarId) => {
    const modules = getNavigableModulesByPillar(pillarId);
    if (railCollapsed) {
      // In compact/instrument icon-only mode, clicking a pillar icon navigates directly to its primary module
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

  const isInstrumentMode = route === 'solarium' || route === 'soloptics';

  return (
    <aside
      className={`rail pillar-rail ${railCollapsed ? 'is-collapsed' : ''} ${
        isInstrumentMode ? 'is-instrument-rail' : ''
      }`}
      aria-label="CONSOL Navigation"
      data-nav-mode={navigationMode}
    >
      {/* Top Brand & Expand/Collapse Rail Control */}
      <div className="rail-head">
        <div className="brand">
          {!railCollapsed ? (
            <div className="consol-brand-lockup">
              <img src={config.CONSOL_LOGO} alt="CONSOL" className="consol-logo-svg" />
            </div>
          ) : (
            <span className="consol-compact-mark" title="CONSOL Scientific Workstation">
              ◈
            </span>
          )}
        </div>
        <button
          type="button"
          className="rail-collapse-btn"
          onClick={() => setRailCollapsed(!railCollapsed)}
          aria-label={railCollapsed ? 'Expand Navigation' : 'Collapse Navigation'}
          title={
            railCollapsed
              ? 'Expand Navigation (232px)'
              : isInstrumentMode
                ? 'Collapse to Instrument Mode (60px)'
                : 'Collapse Navigation (60px)'
          }
        >
          <IconPanelCollapse collapsed={railCollapsed} />
        </button>
      </div>

      {/* Instrument Mode Status / Quick Expand Button when in SOLARIUM */}
      {isInstrumentMode && (
        <button
          type="button"
          className="instrument-rail-toggle-bar"
          onClick={() => setRailCollapsed(!railCollapsed)}
          title={railCollapsed ? 'Expand Navigation' : 'Collapse to Instrument Rail'}
        >
          <IconPanelCollapse collapsed={railCollapsed} />
          {!railCollapsed && <span>Collapse to Instrument Mode</span>}
        </button>
      )}

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

      {/* Compact Specimen Indicator when Rail is Collapsed */}
      {activeSpecimenId && railCollapsed && (
        <button
          type="button"
          className="rail-specimen-compact-badge"
          onClick={() => navigate(`#/samples/${encodeURIComponent(activeSpecimenId)}`)}
          title={`Active Specimen: ${activeSpecimenId} (click to open record)`}
          aria-label={`Active Specimen ${activeSpecimenId}`}
        >
          <span className="specimen-dot-mini" />
        </button>
      )}

      {/* Desktop / Tablet Primary Navigation */}
      <nav className="pillar-nav desktop-pillar-nav" aria-label="Primary">
        {/* CONSOL Primary Command Centre Entry */}
        <button
          type="button"
          className={`rail-item-btn workbench-btn ${route === 'home' ? 'is-active' : ''}`}
          aria-current={route === 'home' ? 'page' : undefined}
          onClick={() => navigate('#/home')}
          title="CONSOL Command Centre"
          aria-label="CONSOL"
        >
          <span className="rail-icon">
            <IconHouse />
          </span>
          {!railCollapsed && <span className="rail-label">CONSOL</span>}
        </button>

        <div className="rail-divider" role="separator" />

        {/* Four Expandable Pillars */}
        <div className="pillar-groups">
          {PILLARS.map(pillar => {
            const isPillarActive = activePillar === pillar.id;
            const isExpanded = expandedPillars[pillar.id];
            const modules = getNavigableModulesByPillar(pillar.id);
            const tooltipLabel =
              pillar.id === 'VISUALISATION'
                ? 'Visualisation · SOLARIUM'
                : pillar.id === 'SCIENCE'
                  ? 'Science · Investigations'
                  : `${pillar.label} (${modules.map(m => m.label).join(', ')})`;

            return (
              <div
                key={pillar.id}
                className={`pillar-group ${isPillarActive ? 'is-active-pillar' : ''} ${
                  isExpanded ? 'is-expanded' : ''
                }`}
              >
                <button
                  type="button"
                  className={`rail-item-btn pillar-trigger ${isPillarActive ? 'is-active' : ''}`}
                  aria-expanded={!railCollapsed ? isExpanded : undefined}
                  aria-label={tooltipLabel}
                  onClick={() => handlePillarHeaderClick(pillar.id)}
                  title={tooltipLabel}
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
                  <div
                    className="pillar-modules"
                    role="group"
                    aria-label={`${pillar.label} destinations`}
                  >
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

      {/* Mobile Compact Header + On-Demand Pillar/Module Menu Drawer */}
      <div className="mobile-compact-header">
        <div className="mobile-header-left">
          <button
            type="button"
            className="mobile-brand-btn"
            onClick={() => {
              setMobileNavOpen(false);
              navigate('#/home');
            }}
          >
            <img src={config.CONSOL_LOGO} alt="CONSOL" className="mobile-consol-logo" />
          </button>
          <span className="mobile-route-sep">/</span>
          <span className="mobile-current-location">{currentSectionTitle}</span>
        </div>

        <div className="mobile-header-right">
          {activeSpecimenId && (
            <button
              type="button"
              className="mobile-specimen-pill"
              onClick={() => {
                setMobileNavOpen(false);
                navigate(`#/samples/${encodeURIComponent(activeSpecimenId)}`);
              }}
              title={`Active specimen: ${activeSpecimenId}`}
            >
              {activeSpecimenId}
            </button>
          )}
          <button
            type="button"
            className={`mobile-menu-trigger ${mobileNavOpen ? 'is-open' : ''}`}
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            aria-expanded={mobileNavOpen}
            aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
          >
            <IconMenu open={mobileNavOpen} />
            <span>{mobileNavOpen ? 'Close' : 'Navigate'}</span>
          </button>
        </div>
      </div>

      {mobileNavOpen && (
        <nav className="mobile-nav-drawer" aria-label="Mobile Navigation Menu">
          <div className="mobile-drawer-section">
            <button
              type="button"
              className={`mobile-drawer-item ${route === 'home' ? 'is-active' : ''}`}
              onClick={() => {
                setMobileNavOpen(false);
                navigate('#/home');
              }}
            >
              <IconHouse />
              <span>CONSOL</span>
            </button>
          </div>

          {PILLARS.map(pillar => {
            const modules = getNavigableModulesByPillar(pillar.id);
            return (
              <div key={pillar.id} className="mobile-drawer-pillar">
                <div className="mobile-drawer-pillar-head">
                  {renderPillarIcon(pillar.id)}
                  <span>{pillar.label}</span>
                </div>
                <div className="mobile-drawer-modules">
                  {modules.map(mod => {
                    const isModActive = mod.route === activeRouteKey;
                    return (
                      <button
                        key={mod.id}
                        type="button"
                        className={`mobile-drawer-mod-btn ${isModActive ? 'is-active' : ''}`}
                        onClick={() => handleModuleClick(mod.route || '', mod.hash)}
                      >
                        {mod.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="mobile-drawer-footer">
            <button
              type="button"
              className={`mobile-drawer-item ${route === 'settings' ? 'is-active' : ''}`}
              onClick={() => {
                setMobileNavOpen(false);
                navigate('#/settings');
              }}
            >
              <IconSettings />
              <span>Settings {user?.email ? `(${user.email})` : ''}</span>
            </button>
          </div>
        </nav>
      )}

      {/* Bottom Pinned Settings & Provenance OS Mark (Desktop) */}
      <div className="rail-footer">
        <button
          type="button"
          className={`rail-item-btn settings-btn ${route === 'settings' ? 'is-active' : ''}`}
          aria-current={route === 'settings' ? 'page' : undefined}
          onClick={() => navigate('#/settings')}
          title="Settings"
          aria-label="Settings"
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
        {!railCollapsed && (
          <div className="rail-provos-footer">
            <img src={config.PROVOS_LOGO} alt="Provenance OS" className="rail-provos-logo" />
          </div>
        )}
      </div>
    </aside>
  );
};
