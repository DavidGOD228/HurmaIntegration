import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Daily           from './pages/Daily';
import Monthly         from './pages/Monthly';
import Employee        from './pages/Employee';
import Settings        from './pages/Settings';
import Contradictions  from './pages/Contradictions';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/"                  element={<Daily />} />
        <Route path="/monthly"           element={<Monthly />} />
        <Route path="/employees/:id"     element={<Employee />} />
        <Route path="/settings"          element={<Settings />} />
        <Route path="/contradictions"    element={<Contradictions />} />
        <Route path="*"                  element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
