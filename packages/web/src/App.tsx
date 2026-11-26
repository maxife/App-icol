import React from 'react';
import { AuthProvider, DataProvider, ToastProvider } from './providers';
import { AppShell } from './shell/AppShell';

export function App(): React.JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <DataProvider>
          <AppShell />
        </DataProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
