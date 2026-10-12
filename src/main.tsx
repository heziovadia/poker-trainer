import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AuthGate } from './ui/components/Auth';
import { initClaudeSync } from './storage/cloudSync';
import { supabaseEnabled } from './config';
import './ui/styles.css';

// The claude.ai page skeleton has no lang/dir on <html>; set them here for every build.
document.documentElement.lang = 'he';
document.documentElement.dir = 'rtl';

const root = createRoot(document.getElementById('root')!);

if (supabaseEnabled) {
  // Public website: every player signs in and gets their own synced progress.
  root.render(
    <StrictMode>
      <AuthGate>
        <App />
      </AuthGate>
    </StrictMode>,
  );
} else {
  root.render(<div className="boot">♠ טוען את Poker Trainer…</div>);
  // claude.ai artifact (or local-only): wait briefly for the cloud copy, then open.
  let mounted = false;
  const mount = () => {
    if (mounted) return;
    mounted = true;
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  };
  initClaudeSync()
    .then((connected) => {
      if (mounted && connected) window.dispatchEvent(new Event('pt-cloud-updated'));
    })
    .finally(mount);
  setTimeout(mount, 6000);
}
