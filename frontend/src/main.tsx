import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import UiGallery from './UiGallery';
import { applyAuroraBackdrop } from './auroraBackdrop';
import './tokens.css';
import './styles.css';
import './history.css';
import './conversation.css';
import './atlas.css';
import './layout.css';
import './chat.css';
import './pages.css';
import './aurora-ui.css';

applyAuroraBackdrop();
// ?view=ui shows every chat piece in each state, without the backend.
const gallery = new URLSearchParams(window.location.search).get('view') === 'ui';
createRoot(document.getElementById('root')!).render(<React.StrictMode>{gallery ? <UiGallery /> : <AppShell />}</React.StrictMode>);
