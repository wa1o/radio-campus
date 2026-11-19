import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Screen from './pages/Screen.jsx';
import Vote from './pages/Vote.jsx';
import Admin from './pages/Admin.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/screen" element={<Screen />} />
      <Route path="/vote" element={<Vote />} />
      <Route path="/admin/*" element={<Admin />} />
      <Route path="*" element={<Navigate to="/vote" replace />} />
    </Routes>
  </BrowserRouter>,
);