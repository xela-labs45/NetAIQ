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
import { Box, Typography, Alert, AlertTitle, Button } from '@mui/material';

function PageErrorFallback({ error }) {
    return (
        <Box sx={{ p: 4 }}>
            <Alert severity="error">
                <AlertTitle>Page Error</AlertTitle>
                {error?.message || 'An unexpected error occurred'}
            </Alert>
            <Typography variant="body2" sx={{ mt: 2, fontFamily: 'monospace', color: 'text.secondary' }}>
                {error?.stack?.split('\n')[1] || ''}
            </Typography>
            <Button
                variant="outlined"
                sx={{ mt: 2 }}
                onClick={() => window.location.reload()}
            >
                Reload Page
            </Button>
        </Box>
    );
}

function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Dashboard />
                    </ErrorBoundary>
                } />
                <Route path="devices" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Devices />
                    </ErrorBoundary>
                } />
                <Route path="segments" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Segments />
                    </ErrorBoundary>
                } />
                <Route path="bandwidth" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Bandwidth />
                    </ErrorBoundary>
                } />
                <Route path="alerts" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Alerts />
                    </ErrorBoundary>
                } />
                <Route path="settings" element={
                    <ErrorBoundary FallbackComponent={PageErrorFallback}>
                        <Settings />
                    </ErrorBoundary>
                } />
            </Route>
        </Routes>
    );
}

export default App;
