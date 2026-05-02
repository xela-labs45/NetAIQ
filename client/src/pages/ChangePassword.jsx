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
    const [form, setForm] = useState({ current_password: '', new_password: '', confirm_password: '' });
    const [error, setError] = useState('');

    const mutation = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/password', data),
        onSuccess: async () => {
            await axios.post('/api/v1/auth/logout');
            queryClient.clear();
            setUser(null);
            navigate('/login', { state: { toast: 'Password changed. Please sign in with your new password.' } });
        },
        onError: (err) => {
            setError(err.response?.data?.message || 'Failed to change password');
        }
    });

    const handleSubmit = (e) => {
        e.preventDefault();
        setError('');
        if (form.new_password !== form.confirm_password) {
            setError('New passwords do not match');
            return;
        }
        mutation.mutate({ current_password: form.current_password, new_password: form.new_password });
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
                    Change Your Password
                </Typography>
                <Alert severity="warning" sx={{ mb: 3, textAlign: 'left' }}>
                    Your account is using the default password. You must set a new password before continuing.
                </Alert>

                {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

                <form onSubmit={handleSubmit}>
                    <TextField
                        fullWidth label="Current Password" type="password" margin="normal" required
                        value={form.current_password}
                        onChange={(e) => setForm({ ...form, current_password: e.target.value })}
                        autoFocus
                    />
                    <TextField
                        fullWidth label="New Password" type="password" margin="normal" required
                        value={form.new_password}
                        onChange={(e) => setForm({ ...form, new_password: e.target.value })}
                        helperText="Minimum 12 characters"
                    />
                    <TextField
                        fullWidth label="Confirm New Password" type="password" margin="normal" required
                        value={form.confirm_password}
                        onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
                        sx={{ mb: 3 }}
                    />
                    <Button
                        type="submit"
                        fullWidth
                        variant="contained"
                        color="warning"
                        size="large"
                        disabled={mutation.isPending}
                    >
                        {mutation.isPending ? <CircularProgress size={24} /> : 'Set New Password'}
                    </Button>
                </form>
            </Card>
        </Box>
    );
}
