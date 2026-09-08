import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
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

function Shell() {
  return (
    <div className="mx-auto min-h-dvh max-w-xl pb-safe-nav">
      <Outlet />
      <BottomNav />
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
  if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  void pathname;
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
          <Route path="history" element={<HistoryScreen />} />
          <Route path="history/:id" element={<SessionDetailScreen />} />
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
