import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Home' },
  { to: '/routines', label: 'Routines' },
  { to: '/food', label: 'Food' },
  { to: '/progress', label: 'Progress' },
  { to: '/settings', label: 'Settings' },
];

/**
 * The tab bar: words only on an edge-to-edge strip of real glass under a hairline, the tab you are
 * on in cream with a dot of the accent over it. The row stays --nav-h (4rem) tall, so every
 * `pb-safe-nav*` padding and the rest timer's stacking line up as before.
 */
export function BottomNav() {
  return (
    <nav aria-label="Main" className="pb-safe glass-fixed fixed inset-x-0 bottom-0 z-30 border-t">
      <div className="content-max mx-auto flex h-16 items-stretch px-1">
        {tabs.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) => `relative flex flex-1 items-center justify-center text-sm ${isActive ? 'font-medium text-fg' : 'text-muted'}`}
          >
            {({ isActive }) => (
              <>
                {isActive && <span aria-hidden="true" className="absolute top-3 h-1 w-1 rounded-full bg-accent" />}
                <span className="pt-1.5">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
