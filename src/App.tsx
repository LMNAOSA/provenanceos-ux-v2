/**
 * CONSOL Application Root
 * Orchestrates authentication state, route protection, context providers, and the application shell.
 * Protected application content (<AppProvider><Shell /></AppProvider>) only mounts after both
 * a valid Supabase session AND staff membership (isStaff) have been verified.
 */

import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppProvider } from './context/AppContext';
import { Shell } from './components/layout/Shell';
import {
  BootingScreen,
  OfflineScreen,
  SetupScreen,
  LoginScreen,
  PendingScreen
} from './components/auth/AuthScreens';

const AppContent: React.FC = () => {
  const { status, isStaff, session, user } = useAuth();

  switch (status) {
    case 'booting':
      return <BootingScreen />;
    case 'offline':
      return <OfflineScreen />;
    case 'missing_schema':
      return <SetupScreen />;
    case 'unauthenticated':
      return <LoginScreen />;
    case 'pending':
      return <PendingScreen />;
    case 'authenticated':
      if (!isStaff || !session || !user) {
        return <LoginScreen />;
      }
      return (
        <AppProvider>
          <Shell />
        </AppProvider>
      );
    default:
      return <BootingScreen />;
  }
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
};

export default App;
