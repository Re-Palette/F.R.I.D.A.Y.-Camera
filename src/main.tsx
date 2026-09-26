import '@fontsource/rajdhani/latin-400.css';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/share-tech-mono/latin-400.css';
import { createRoot } from 'react-dom/client';
import App from './App';
import { initPwa } from './pwa';
import './hud/hud.css';

initPwa();

createRoot(document.getElementById('root')!).render(<App />);
