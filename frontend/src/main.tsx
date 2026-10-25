import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';
import {StartupScreen} from './StartupScreen';
import './styles.css';
import './markdown.css';
import './chatDock.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><StartupScreen><App/></StartupScreen></React.StrictMode>);
