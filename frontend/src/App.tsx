import { BrowserRouter, Routes, Route } from 'react-router-dom';
import AdminShell from './components/AdminShell';
import LandingPage from './pages/LandingPage';
import AdminLogin from './pages/admin/AdminLogin';
import UploadPresentation from './pages/admin/UploadPresentation';
import ConfigureSlides from './pages/admin/ConfigureSlides';
import PresentationSessions from './pages/admin/PresentationSessions';
import ControlSession from './pages/admin/ControlSession';
import SessionResults from './pages/admin/SessionResults';
import JoinSession from './pages/user/JoinSession';
import ViewSession from './pages/user/ViewSession';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin/presentations" element={<AdminShell><UploadPresentation /></AdminShell>} />
        <Route
          path="/admin/presentations/:id/sessions"
          element={<AdminShell><PresentationSessions /></AdminShell>}
        />
        <Route
          path="/admin/presentations/:id/configure"
          element={<AdminShell><ConfigureSlides /></AdminShell>}
        />
        <Route
          path="/admin/sessions/:code"
          element={<AdminShell><ControlSession /></AdminShell>}
        />
        <Route
          path="/admin/sessions/:code/results"
          element={<AdminShell><SessionResults /></AdminShell>}
        />
        {/* Deep-link from QR / shared URL: /join/:code auto-fills the form. */}
        <Route path="/join" element={<JoinSession />} />
        <Route path="/join/:code" element={<JoinSession />} />
        <Route path="/session/:code" element={<ViewSession />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}