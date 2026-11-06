import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { ClinicianProvider } from './state/ClinicianContext';
import { NotificationsProvider } from './state/NotificationsContext';
import { InboxPage } from './pages/InboxPage';
import { ConversationPage } from './pages/ConversationPage';
import { EmptyState, LoadingState } from './components/ui';
import { PatientsPage } from './pages/PatientsPage';
import { PatientDashboard } from './pages/PatientDashboard';
import { TrackersPage } from './pages/TrackersPage';
import { StudiesPage } from './pages/StudiesPage';

const ChartGallery = lazy(() => import('./components/charts/ChartGallery'));

export default function App() {
  return (
    <ClinicianProvider>
    <NotificationsProvider>
    <AppShell>
      <Routes>
        <Route path="/" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<PatientDashboard />} />
        <Route path="/inbox" element={<InboxPage />} />
        <Route path="/inbox/:conversationId" element={<ConversationPage />} />
        <Route path="/trackers" element={<TrackersPage />} />
        <Route path="/studies" element={<StudiesPage />} />
        <Route
          path="/dev/charts"
          element={
            <Suspense fallback={<LoadingState label="Loading chart gallery…" />}>
              <ChartGallery />
            </Suspense>
          }
        />
        <Route
          path="*"
          element={
            <EmptyState title="This page doesn’t exist" action={<Link className="btn" to="/">Go to patients</Link>}>
              Check the address, or start from the patient list.
            </EmptyState>
          }
        />
      </Routes>
    </AppShell>
    </NotificationsProvider>
    </ClinicianProvider>
  );
}
