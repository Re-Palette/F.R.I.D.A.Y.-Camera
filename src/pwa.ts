/**
 * PWA: service-worker registration + Chrome's install prompt.
 * `beforeinstallprompt` can fire before React mounts, so it is captured here
 * at module load and exposed through a tiny store.
 */
import { registerSW } from 'virtual:pwa-register';
import { create } from 'zustand';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaState {
  prompt: BeforeInstallPromptEvent | null;
  installed: boolean;
  dismissed: boolean;
}

const isStandalone = () =>
  matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const usePwa = create<PwaState>(() => ({ prompt: null, installed: isStandalone(), dismissed: false }));

export function initPwa() {
  if ('serviceWorker' in navigator && import.meta.env.PROD) registerSW({ immediate: true });
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    usePwa.setState({ prompt: e as BeforeInstallPromptEvent });
  });
  window.addEventListener('appinstalled', () => usePwa.setState({ prompt: null, installed: true }));
}

/** Shows Chrome's native install dialog. Returns true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const p = usePwa.getState().prompt;
  if (!p) return false;
  await p.prompt();
  const { outcome } = await p.userChoice;
  usePwa.setState({ prompt: null, installed: outcome === 'accepted' });
  return outcome === 'accepted';
}
