import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Login } from '@/components/auth/Login';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { AppShell } from '@/components/layout/AppShell';
import { Hubs } from '@/pages/Hubs';
import { Devices } from '@/pages/Devices';
import { Telemetry } from '@/pages/Telemetry';
import { Flash } from '@/pages/Flash';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/*"
          element={
            <ProtectedRoute>
              <AppShell>
                <Routes>
                  <Route path="/" element={<Hubs />} />
                  <Route path="/devices" element={<Devices />} />
                  <Route path="/telemetry" element={<Telemetry />} />
                  <Route path="/flash" element={<Flash />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </AppShell>
            </ProtectedRoute>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
