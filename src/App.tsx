import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { fmtDuration } from './domain/format';
import { useNow, useSessionDock } from './ui/hooks';
import { useTimer } from './state/timer';
import { Ambient } from './ui/Ambient';
import { BottomNav } from './ui/components/BottomNav';
import { ToastHost } from './ui/components/Toast';
import { RestTimerBar } from './ui/RestTimerBar';
import { HomeScreen } from './screens/HomeScreen';
import { RoutinesScreen } from './screens/RoutinesScreen';
import { RoutineEditScreen } from './screens/RoutineEditScreen';
import { ExercisesScreen } from './screens/ExercisesScreen';
import { ExerciseEditScreen } from './screens/ExerciseEditScreen';
import { ExerciseDetailScreen } from './screens/ExerciseDetailScreen';
import { LiveSessionScreen } from './screens/LiveSessionScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { SessionDetailScreen } from './screens/SessionDetailScreen';
import { BodyweightScreen } from './screens/BodyweightScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { CheckInScreen } from './screens/CheckInScreen';
import { FoodScreen } from './screens/FoodScreen';
import { MealEditScreen } from './screens/MealEditScreen';
import { ProgressScreen } from './screens/ProgressScreen';
import { RecipesScreen } from './screens/RecipesScreen';
import { RecipeBuilderScreen } from './screens/RecipeBuilderScreen';

function Shell() {
  const dock = useSessionDock();
  // A running rest timer floats over the bottom of the page too; pad for it so the last row of a
  // screen is never stuck underneath it.
  const resting = useTimer((s) => s.endsAt !== null);
  const pad = dock ? (resting ? 'pb-safe-nav-dock-timer' : 'pb-safe-nav-dock') : resting ? 'pb-safe-nav-timer' : 'pb-safe-nav';
  return (
    <div className={`content-max mx-auto min-h-dvh ${pad}`}>
      <Outlet />
      {dock && <SessionDock session={dock} />}
      <BottomNav />
    </div>
  );
}

/**
 * The way back into a running workout from any tab screen, docked just above the tab bar.
 *
 * It used to be a strip across the top of the screen, and on the owner's Galaxy Z Fold 8 it drew
 * under the Android status bar: its text collided with the clock and battery, and a tap there pulls
 * down the notification shade instead of reaching the app. Padding it for the inset was tried and
 * did not reach the phone. At the bottom it cannot collide with the status bar whatever the inset,
 * and it sits where the thumb already is — which is also where Hevy puts its in-progress bar.
 */
function SessionDock({ session }: { session: { id: string; title: string; startedAt: string } }) {
  const nav = useNavigate();
  const now = useNow(1000, true);
  const elapsed = Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000));
  return (
    <div className="bottom-dock content-max fixed inset-x-0 z-30 mx-auto px-3">
      <button
        type="button"
        onClick={() => nav(`/session/${session.id}`)}
        className="glass-fixed glass-fixed-accent active:brightness-95 flex h-[var(--dock-h)] w-full items-center gap-3 rounded-pill border py-0 pl-4 pr-2 text-left text-fg"
        data-testid="live-banner"
      >
        <span aria-hidden="true" className="pulse-ring h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Live</span>
          <span className="block truncate text-base font-extrabold leading-tight">{session.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="num text-base font-extrabold">{fmtDuration(elapsed)}</span>
          <span className="rounded-control bg-accent px-3 py-1.5 text-sm font-bold text-accent-fg">Resume</span>
        </span>
      </button>
    </div>
  );
}

function SessionShell() {
  const { pathname } = useLocation();
  // The live session (not Summary) widens at the Fold breakpoint (src/index.css `.fold-shell`,
  // `min-width: 840px`) so its two panes have room; every other session route keeps the ordinary
  // phone-width column. A plain CSS class, so folding or unfolding mid-workout just reflows —
  // no JS breakpoint check, no remount.
  const isLiveSession = /^\/session\/[^/]+$/.test(pathname);
  return (
    <div className={`mx-auto min-h-dvh ${isLiveSession ? 'session-shell' : 'content-max'}`}>
      <Outlet />
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  // Reset scroll on route change (mobile browsers keep the previous offset otherwise).
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Ambient />
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<HomeScreen />} />
          <Route path="routines" element={<RoutinesScreen />} />
          <Route path="routines/:id" element={<RoutineEditScreen />} />
          <Route path="exercises" element={<ExercisesScreen />} />
          <Route path="exercises/new" element={<ExerciseEditScreen />} />
          <Route path="exercises/:id" element={<ExerciseDetailScreen />} />
          <Route path="exercises/:id/edit" element={<ExerciseEditScreen />} />
          <Route path="food" element={<FoodScreen />} />
          <Route path="food/new" element={<MealEditScreen />} />
          {/* Static, so they outrank food/:id (React Router ranks a literal segment above a
              dynamic one regardless of declaration order — kept here first anyway for clarity). */}
          <Route path="food/recipes" element={<RecipesScreen />} />
          <Route path="food/recipes/new" element={<RecipeBuilderScreen />} />
          <Route path="food/recipes/:id/edit" element={<RecipeBuilderScreen />} />
          <Route path="food/:id" element={<MealEditScreen />} />
          <Route path="history" element={<HistoryScreen />} />
          <Route path="history/:id" element={<SessionDetailScreen />} />
          <Route path="progress" element={<ProgressScreen />} />
          <Route path="body" element={<BodyweightScreen />} />
          <Route path="settings" element={<SettingsScreen />} />
          <Route path="checkin" element={<CheckInScreen />} />
        </Route>
        <Route element={<SessionShell />}>
          <Route path="session/:id" element={<LiveSessionScreen />} />
          <Route path="session/:id/summary" element={<SummaryScreen />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <RestTimerBar />
      <ToastHost />
    </BrowserRouter>
  );
}
