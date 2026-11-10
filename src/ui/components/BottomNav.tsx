import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/routines', label: 'Routines', icon: RoutinesIcon },
  { to: '/food', label: 'Food', icon: FoodIcon },
  { to: '/progress', label: 'Progress', icon: ProgressIcon },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];

/**
 * The tab bar: an edge-to-edge strip of real glass under a hairline, each tab a fine line icon over
 * its name. The tab you are on has its icon in the accent and its name in cream. The row stays
 * --nav-h (4rem) tall, so every `pb-safe-nav*` padding and the rest timer's stacking line up as before.
 */
export function BottomNav() {
  return (
    <nav aria-label="Main" className="pb-safe glass-fixed fixed inset-x-0 bottom-0 z-30 border-t">
      <div className="content-max mx-auto flex h-16 items-stretch px-1">
        {tabs.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-1 text-[11px] tracking-[0.02em] ${isActive ? 'font-medium text-fg' : 'text-muted'}`}
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
