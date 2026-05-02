import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Card, CircularProgress, Alert } from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ChangePassword() {
    const navigate = useNavigate();
    const { setUser } = useAuth();
    const queryClient = useQueryClient();
    const [form, setForm] = useState({ new_username: '', current_password: '', new_password: '', confirm_password: '' });
    const [error, setError] = useState('');

    const mutation = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/password', data),
        onSuccess: async () => {
            await axios.post('/api/v1/auth/logout');
            queryClient.clear();
            setUser(null);
            navigate('/login', { state: { toast: 'Account setup complete. Please sign in with your new credentials.' } });
        },
        onError: (err) => {
            setError(err.response?.data?.message || 'Failed to complete account setup');
        }
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');

        if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,30}$/.test(form.new_username)) {
            setError('Username must be 3–31 characters and may only contain letters, numbers, underscores, and hyphens.');
            return;
        }
        if (form.new_password !== form.confirm_password) {
            setError('New passwords do not match');
            return;
        }
        mutation.mutate({
            new_username: form.new_username,
            current_password: form.current_password,
            new_password: form.new_password
        });
    };

    return (
        <Box sx={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'background.default'
        }}>
            <Card sx={{ p: 4, width: '100%', maxWidth: 420, textAlign: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center', mb: 3 }}>
                    <Box
                        component="img"
                        src="/mark-color.svg"
                        alt="NetAIQ"
                        sx={{ width: 64, height: 64 }}
                    />
                </Box>
                <Typography variant="h5" fontWeight="bold" gutterBottom sx={{ letterSpacing: '-0.02em' }}>
                    Set Up Your Account
                </Typography>
                <Alert severity="warning" sx={{ mb: 3, textAlign: 'left' }}>
                    This account is using default credentials. Choose a unique username and a new password to continue.
                </Alert>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth label="Choose a Username" margin="normal" required
                        value={form.new_username}
                        onChange={(e) => setForm({ ...form, new_username: e.target.value })}
                        helperText="3–31 characters: letters, numbers, underscores, hyphens"
                        autoFocus
                        autoComplete="username"
                        inputProps={{ maxLength: 31 }}
                    />
                    <TextField
                        fullWidth label="Current Password" type="password" margin="normal" required
                        value={form.current_password}
                        onChange={(e) => setForm({ ...form, current_password: e.target.value })}
                        autoComplete="current-password"
                    />
                    <TextField
                        fullWidth label="New Password" type="password" margin="normal" required
                        value={form.new_password}
                        onChange={(e) => setForm({ ...form, new_password: e.target.value })}
                        helperText="Minimum 12 characters"
                        autoComplete="new-password"
                    />
                    <TextField
                        fullWidth label="Confirm New Password" type="password" margin="normal" required
                        value={form.confirm_password}
                        onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                        sx={{ mb: 3 }}
                        autoComplete="new-password"
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        color="warning"
                        size="large"
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? <CircularProgress size={24} /> : 'Complete Setup'}
                    </Button>
                </form>
            </Card>
        </Box>
    );
}
