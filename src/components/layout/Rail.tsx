/**
 * CONSOL Navigation Rail
 * Persistent desktop/mobile sidebar providing primary navigation across operational routes.
 */

import React from 'react';
import config from '../../config';
import { APP_ROUTES } from '../../types/routes';
import { useApp } from '../../context/AppContext';

export const Rail: React.FC = () => {
  const { route, navigate } = useApp();

  // If viewing a single sample, highlight 'samples' in the rail
  const activeSlug = route === 'sample' ? 'samples' : route;

  return (
    <aside className="rail">
      <div className="brand">
        <img src={config.APP_LOGO} alt="Australian Provenance Project" />
        <div className="system">
          <img src={config.SYS_LOGO} alt="" />
          <span>ProvenanceOS</span>
        </div>
      </div>

      <nav className="nav" aria-label="Main">
        {APP_ROUTES.map(item => {
          const isActive = item.slug === activeSlug;
          return (
            <button
              key={item.id}
              className={isActive ? 'active' : ''}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigate(item.hash)}
            >
              {item.name}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
