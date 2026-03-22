import React from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import HomePage from './pages/HomePage';
import TeamPage from './pages/TeamPage';
import EventPage from './pages/EventPage';
import PredictPage from './pages/PredictPage';
import LocksPage from './pages/LocksPage';
import './App.css';

function App() {
  const location = useLocation();

  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="nav-brand">
          <span className="brand-icon">◆</span>
          Predictobics
        </Link>
        <div className="nav-links">
          <Link to="/" className={location.pathname === '/' ? 'active' : ''}>
            Events
          </Link>
          <Link to="/predict" className={location.pathname === '/predict' ? 'active' : ''}>
            Predict
          </Link>
          <Link to="/locks" className={location.pathname === '/locks' ? 'active' : ''}>
            Locks
          </Link>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/team/:teamKey" element={<TeamPage />} />
          <Route path="/event/:eventKey" element={<EventPage />} />
          <Route path="/predict" element={<PredictPage />} />
          <Route path="/locks" element={<LocksPage />} />
        </Routes>
      </main>
      <footer className="footer">
        <p className="footer-line">
          Developed by{' '}
          <a href="https://www.thebluealliance.com/team/1294" target="_blank" rel="noreferrer">
            FRC Team 1294
          </a>
          <span className="footer-sep" aria-hidden="true">
            ·
          </span>
          <a href="https://github.com/cliclye/predictobics" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </p>
        <p className="footer-line">
          Powered by{' '}
          <a href="https://www.thebluealliance.com" target="_blank" rel="noreferrer">
            The Blue Alliance
          </a>
        </p>
      </footer>
    </div>
  );
}

export default App;
