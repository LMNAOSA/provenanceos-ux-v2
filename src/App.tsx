/**
 * CONSOL Application Root
 * Orchestrates authentication state, context providers, and the application shell.
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
  const { status } = useAuth();

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
      return <Shell />;
    default:
      return <BootingScreen />;
  }
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </AuthProvider>
  );
};

export default App;
