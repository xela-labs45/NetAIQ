import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Devices from './pages/Devices';
import Segments from './pages/Segments';
import Bandwidth from './pages/Bandwidth';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import { useAuth } from './hooks/useAuth';

function PrivateRoute({ children }) {
    const { user, loading } = useAuth();

    if (loading) return null;

    if (!user) {
        return <Navigate to="/login" />;
    }

    return children;
}

function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={<Dashboard />} />
                <Route path="devices" element={<Devices />} />
                <Route path="segments" element={<Segments />} />
                <Route path="bandwidth" element={<Bandwidth />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="settings" element={<Settings />} />
            </Route>
        </Routes>
    );
}

export default App;
