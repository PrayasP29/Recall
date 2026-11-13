import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import NewTabDashboard from './NewTabDashboard.jsx';

createRoot(document.getElementById('recall-newtab-root')).render(
  <StrictMode>
    <NewTabDashboard />
  </StrictMode>,
);
