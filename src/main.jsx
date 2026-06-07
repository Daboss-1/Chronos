import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { NT4Provider } from '@frc-web-components/react/networktables';
import { ThemeProvider } from './contexts/ThemeContext';
import { I18nProvider } from './contexts/I18nContext';
import { LayoutProvider } from './contexts/LayoutContext';
import { RewindProvider } from './contexts/RewindContext';
import App from './App';
import './styles/main.css';
import './styles/stages.css';
import './styles/features.css';

/**
 * Resolves the NT4 robot address.
 *
 * In Electron: asks the main process via window.electronAPI.getRobotAddress(),
 * then subscribes to future address changes (auto-discovery or manual override).
 *
 * In a plain browser (dev without Electron): falls back to 'localhost'.
 */
function ChronosRoot() {
  const [robotAddress, setRobotAddress] = useState(null); // null = loading

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      // Running in browser outside of Electron
      setRobotAddress('localhost');
      return;
    }

    // Fetch the initial address (may come from auto-discovery or stored override)
    api.getRobotAddress().then((addr) => {
      setRobotAddress(addr ?? 'localhost');
    });

    // Subscribe to future changes
    const unsub = api.onRobotAddressChange((addr) => {
      setRobotAddress(addr ?? 'localhost');
    });

    return unsub;
  }, []);

  // Don't render until we have an address
  if (robotAddress === null) return null;

  return (
    <React.StrictMode>
      <ThemeProvider>
        <I18nProvider>
          <LayoutProvider>
            <NT4Provider address={robotAddress}>
              <RewindProvider>
                <App robotAddress={robotAddress} />
              </RewindProvider>
            </NT4Provider>
          </LayoutProvider>
        </I18nProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<ChronosRoot />);
