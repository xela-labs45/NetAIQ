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

import { ErrorBoundary } from 'react-error-boundary';
import { Box, Typography } from '@mui/material';

function ErrorFallback({ error }) {
    return (
        <Box sx={{ p: 4, color: 'error.main' }}>
            <Typography variant="h6">Something went wrong:</Typography>
            <Typography variant="body2" sx={{ fontFamily: 'monospace', mt: 1 }}>{error.message}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                Check browser console for details.
            </Typography>
        </Box>
    );
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
                <Route path="bandwidth" element={
                    <ErrorBoundary FallbackComponent={ErrorFallback}>
                        <Bandwidth />
                    </ErrorBoundary>
                } />
                <Route path="alerts" element={<Alerts />} />
                <Route path="settings" element={<Settings />} />
            </Route>
        </Routes>
    );
}

export default App;
