import React from 'react';
import { createRoot } from 'react-dom/client';
import AppShell from './AppShell';
import './styles.css';
import './history.css';
import './conversation.css';
import './atlas.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><AppShell /></React.StrictMode>);
