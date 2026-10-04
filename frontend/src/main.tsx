import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import './tokens.css';
import './styles.css';
import './history.css';
import './conversation.css';
import './atlas.css';
import './layout.css';
import './chat.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AppShell /></React.StrictMode>);
