import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { SeedPage } from './pages/SeedPage';
import { CleanPage } from './pages/CleanPage';
import { useTheme } from './hooks/useTheme';

export default function App() {
  // Initialize theme on mount — applies dark class to <html> before first paint
  useTheme();

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/seed" element={<SeedPage />} />
        <Route path="/clean" element={<CleanPage />} />
      </Route>
    </Routes>
  );
}
