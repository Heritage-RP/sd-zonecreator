import React, { useState, useEffect } from 'react';
import './App.css';
import ZoneCreator, { type EditSession } from './components/ZoneCreator';

const GetParentResourceName = (): string => {
  if (window.GetParentResourceName) {
    return window.GetParentResourceName();
  }
  return 'sd-zonecreator';
};

const App: React.FC = () => {
  const [visible, setVisible] = useState(false);
  // Héritage RP: set when another resource (hrp-zones) opened the creator to edit one of its zones.
  const [session, setSession] = useState<EditSession | null>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { action, data } = event.data;

      switch (action) {
        case 'showZoneCreator':
          setSession(null);
          setVisible(true);
          break;
        case 'openEditSession':
          setSession(data as EditSession);
          setVisible(true);
          break;
        case 'hideZoneCreator':
          setVisible(false);
          setSession(null);
          break;
        case 'copyToClipboard':
          if (data?.text) {
            navigator.clipboard.writeText(data.text).catch(console.error);
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && visible) {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // In an edit session, closing cancels it (client.lua answers the session with no zone).
  const handleClose = () => {
    setVisible(false);
    setSession(null);
    fetch(`https://${GetParentResourceName()}/closeZoneCreator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).catch(() => {});
  };

  if (!visible) return null;

  return <ZoneCreator key={session?.sessionId ?? 'standalone'} onClose={handleClose} session={session} />;
};

export default App;
