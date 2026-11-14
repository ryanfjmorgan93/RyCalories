import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/routines', label: 'Routines', icon: RoutinesIcon },
  { to: '/food', label: 'Food', icon: FoodIcon },
  { to: '/progress', label: 'Progress', icon: ProgressIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * The tab bar (v5, November 2026): an island of real glass floating above the bottom edge, each tab
 * a fine line icon over its name in small capitals. The tab you are on sits on a soft lit pill with
 * its icon in the accent. The island leaves room at its right for the coach's disc (CoachFab), which
 * floats in the same row, so neither covers the page. --nav-h is the island plus the gap under it.
 */
export function BottomNav() {
  return (
    <nav aria-label="Main" className="pointer-events-none fixed inset-x-0 bottom-0 z-30" style={{ paddingBottom: 'calc(var(--inset-bottom) + 0.75rem)' }}>
      <div className="content-max mx-auto px-4 pr-[5.25rem]">
        <div className="glass-fixed pointer-events-auto grid h-16 grid-cols-5 items-center rounded-full px-1 shadow-[inset_0_0_0_1px_rgba(243,239,230,0.09),0_24px_48px_-16px_rgba(0,0,0,0.9)]">
          {tabs.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex h-14 flex-col items-center justify-center gap-1 rounded-full text-[9px] font-medium uppercase tracking-[0.08em] ${isActive ? 'bg-fg/[0.08] text-fg' : 'text-muted'}`
              }
            >
              {({ isActive }) => (
                <>
                  <span className={isActive ? 'text-accent' : ''}>
                    <Icon />
                  </span>
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
    </nav>
  );
}

/* One family: a 24-unit grid, 1.5 strokes, round ends and joins, drawn for this bar. */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
function HomeIcon() {
  return (
    <Glyph>
      <path d="M3.5 10.5 12 3.8l8.5 6.7" />
      <path d="M5.5 9v10.2a.8.8 0 0 0 .8.8h3.9v-5.4h3.6V20h3.9a.8.8 0 0 0 .8-.8V9" />
    </Glyph>
  );
}
function RoutinesIcon() {
  // A dumbbell: the routines are the training.
  return (
    <Glyph>
      <path d="M6.5 7.5v9M9 6v12M15 6v12M17.5 7.5v9M9 12h6M3.8 10.2v3.6M20.2 10.2v3.6" />
    </Glyph>
  );
}
function FoodIcon() {
  return (
    <Glyph>
      <path d="M7 3.5v5.2a2 2 0 0 0 4 0V3.5M9 3.5v17" />
      <path d="M17 20.5V3.5c-2 1.3-3.2 3.8-3.2 6.7 0 1.9.9 3.1 2.2 3.3H17" />
    </Glyph>
  );
}
function ProgressIcon() {
  return (
    <Glyph>
      <path d="M3.5 20.5h17" />
      <path d="M4.5 16.5 9.2 11l3.6 3.2 6.7-7.7" />
      <path d="M15.5 6.5h4v4" />
    </Glyph>
  );
}
function SettingsIcon() {
  // Sliders: what is set here is tuned, not repaired.
  return (
    <Glyph>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Glyph>
  );
}
