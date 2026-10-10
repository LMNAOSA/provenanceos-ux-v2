/**
 * CONSOL Top Header Component
 * Renders consistent typographic hierarchy across all operational screens.
 */

import React from 'react';

export interface TopHeaderProps {
  eyebrow: string;
  title: string;
  sub?: string;
  action?: React.ReactNode;
}

export const TopHeader: React.FC<TopHeaderProps> = ({ eyebrow, title, sub, action }) => {
  return (
    <header className="top">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">{title}</h1>
        {sub && <div className="sub">{sub}</div>}
      </div>
      {action && <div className="header-actions">{action}</div>}
    </header>
  );
};
