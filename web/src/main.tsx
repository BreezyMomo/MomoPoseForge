import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import {startSiteAnalytics} from './siteAnalytics';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
if(import.meta.env.PROD)startSiteAnalytics();
