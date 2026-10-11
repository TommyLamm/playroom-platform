import { useContext, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Gamepad2, Grid2X2, Settings2 } from 'lucide-react';
import { canAccessAdmin } from '../../shared/account';
import { PlayerLibraryProvider } from '../player-library';
import { VisitorTracking } from '../visitor-tracking';
import { SessionContext } from './session';
import { AccountNav } from '../features/account/account-nav';

export function AppLayout({ children }: { children: ReactNode }) {
  const { session } = useContext(SessionContext);
  return <>
    <VisitorTracking session={session} />
    <PlayerLibraryProvider session={session} key={session?.authenticated ? `${session.username}:${session.csrf}` : 'guest'}>
      <header className="site-header">
            <div className="header-inner">
              <Link className="brand" to="/" aria-label="小遊戲集合所首頁">
                <span className="brand-icon">
                  <Gamepad2 size={25} />
                </span>
                <span>
                  PLAYROOM<small>小遊戲集合所</small>
                </span>
              </Link>
              <nav aria-label="主要導覽">
                <NavLink to="/" end>
                  <Grid2X2 size={16} />
                  <span>遊戲大廳</span>
                </NavLink>
                {session?.authenticated && canAccessAdmin(session.role) && (
                  <NavLink to="/admin">
                    <Settings2 size={16} />
                    <span>管理後台</span>
                  </NavLink>
                )}
              </nav>
              <AccountNav />
            </div>
          </header>

{children}
<footer className="site-footer">
            <span>
              PLAYROOM <span className="footer-divider">/</span> 留一點時間給好玩的事
            </span>
            <span>Made for a little break.</span>
          </footer>

    </PlayerLibraryProvider>
  </>;
}
