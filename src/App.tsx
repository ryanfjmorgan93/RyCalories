import { useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { fmtDuration } from './domain/format';
import { useNow, useSessionDock } from './ui/hooks';
import { useTimer } from './state/timer';
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

function Shell() {
  const dock = useSessionDock();
  // A running rest timer floats over the bottom of the page too; pad for it so the last row of a
  // screen is never stuck underneath it.
  const resting = useTimer((s) => s.endsAt !== null);
  const pad = dock ? (resting ? 'pb-safe-nav-dock-timer' : 'pb-safe-nav-dock') : resting ? 'pb-safe-nav-timer' : 'pb-safe-nav';
  return (
    <div className={`mx-auto min-h-dvh max-w-xl ${pad}`}>
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
    <div className="bottom-dock fixed inset-x-0 z-30 mx-auto max-w-xl px-3">
      <button
        type="button"
        onClick={() => nav(`/session/${session.id}`)}
        className="flex h-[var(--dock-h)] w-full items-center justify-between gap-3 rounded-2xl bg-accent px-4 text-left text-accent-fg shadow-[0_10px_30px_rgb(0_0_0/0.45)] active:brightness-95"
        data-testid="live-banner"
      >
        <span className="min-w-0">
          <span className="block text-[11px] font-bold uppercase tracking-[0.12em] opacity-75">Live</span>
          <span className="block truncate text-base font-extrabold leading-tight">{session.title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="num text-base font-extrabold">{fmtDuration(elapsed)}</span>
          <span className="rounded-xl bg-accent-fg/15 px-3 py-1.5 text-sm font-bold">Resume</span>
        </span>
      </button>
    </div>
  );
}

function SessionShell() {
  return (
    <div className="mx-auto min-h-dvh max-w-xl">
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
