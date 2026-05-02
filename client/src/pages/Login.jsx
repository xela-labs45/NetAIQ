import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Card, CircularProgress, Alert } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const { login } = useAuth();
    const location = useLocation();
    const successMessage = location.state?.toast || '';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            await login(username, password);
        } catch (err) {
            setError(err.response?.data?.message || 'Login failed. Please check your credentials.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default'
        }}>
            <Card sx={{ p: 4, width: '100%', maxWidth: 400, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                    <Box
                        component="img"
                        src="/mark-color.svg"
                        alt="NetAIQ"
                        sx={{ width: 64, height: 64 }}
                    />
                </Box>
                <Typography
                    variant="h5"
                    component="h1"
                    gutterBottom
                    fontWeight="bold"
                    sx={{ letterSpacing: '-0.02em' }}
                >
                    NetAIQ Dashboard
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Sign in to access your network monitoring tools.
                </Typography>

                {successMessage && <Alert severity="success" sx={{ mb: 3 }}>{successMessage}</Alert>}
                {error && <Alert severity="error" sx={{ mb: 3 }}>{error}</Alert>}

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth
                        label="Username"
                        variant="outlined"
                        margin="normal"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        required
                        autoComplete="username"
                        autoFocus
                    />
                    <TextField
                        fullWidth
                        label="Password"
                        type="password"
                        variant="outlined"
                        margin="normal"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        autoComplete="current-password"
                        sx={{ mb: 3 }}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        color="primary"
                        size="large"
                        disabled={loading}
                    >
                        {loading ? <CircularProgress size={24} /> : 'Sign In'}
                    </Button>
                </form>
            </Card>
        </Box>
    );
}
