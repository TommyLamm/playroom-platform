import React, { useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom';
import { SessionContext, SessionProvider } from './environment/session';
import { NoticeProvider, useNotice } from './environment/notices';
import { AppLayout } from './environment/app-layout';
import { Empty } from './ui/status';
import { Lobby } from './features/lobby/lobby-page';
import { GameDetail } from './features/player/game-detail';
import { PlayPage } from './features/player/play-page';
import { AuthPage } from './features/account/auth-page';
import { Admin } from './features/admin/admin-workspace';
import { CareerPage } from './career';
import { AccountSettingsPage } from './account-settings';
import './styles.css';
import './admin-workspace.css';
import './lobby.css';
import './analytics-workspace.css';

function AppRoutes() {
  const { session, refresh } = useContext(SessionContext);
  const notify = useNotice();
  return <Routes>
    <Route path="/" element={<Lobby />} />
    <Route path="/games/:id" element={<GameDetail />} />
    <Route path="/play/:id" element={<PlayPage />} />
    <Route path="/players/:username" element={<CareerPage session={session} />} />
    <Route path="/settings/account" element={<AccountSettingsPage session={session} onSessionChanged={refresh} notify={notify} />} />
    <Route path="/login" element={<AuthPage key="login" />} />
    <Route path="/register" element={<AuthPage key="register" register />} />
    <Route path="/admin" element={<Admin />} />
    <Route path="*" element={<Empty title="找不到這個頁面" text="回到大廳，挑一款遊戲吧。"><Link className="button primary" to="/">返回大廳</Link></Empty>} />
  </Routes>;
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SessionProvider><NoticeProvider><BrowserRouter><AppLayout><AppRoutes /></AppLayout></BrowserRouter></NoticeProvider></SessionProvider>
  </React.StrictMode>,
);
