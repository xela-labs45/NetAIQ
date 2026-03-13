import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Button, TextField, Grid, Card, Checkbox, Switch,
    FormControlLabel, Tabs, Tab, Alert, Snackbar, InputAdornment, IconButton,
    MenuItem, Chip, CircularProgress
} from '@mui/material';
import {
    Visibility, VisibilityOff, Save as SaveIcon, PlayArrow as TestIcon,
    CheckCircle as ConnectedIcon, Error as ErrorIcon, HelpOutline as UnknownIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../hooks/useAuth';

function TabPanel(props) {
    const { children, value, index, ...other } = props;
    return (
        <div role="tabpanel" hidden={value !== index} {...other} style={{ paddingTop: '24px' }}>
            {value === index && children}
        </div>
    );
}

// Connection status chip shown next to the UniFi tab title
function UnifiStatusChip({ status }) {
    if (status === 'connected') return <Chip icon={<ConnectedIcon />} label="Connected" color="success" size="small" sx={{ ml: 1 }} />;
    if (status === 'error') return <Chip icon={<ErrorIcon />} label="Error" color="error" size="small" sx={{ ml: 1 }} />;
    if (status === 'testing') return <Chip icon={<CircularProgress size={12} />} label="Testing…" size="small" sx={{ ml: 1 }} />;
    return null;
}

export default function Settings() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [tabIndex, setTabIndex] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
    const [unifiStatus, setUnifiStatus] = useState(null); // null | 'testing' | 'connected' | 'error'

    // Forms state
    const [unifi, setUnifi] = useState({
        unifi_url: '', unifi_username: '', unifi_password: '', unifi_site: 'default', unifi_ssl_verify: false
    });

    const [email, setEmail] = useState({
        smtp_host: '', smtp_port: '587', smtp_secure: false, smtp_user: '', smtp_pass: '',
        alert_from: '', alert_to: '',
        alert_on_offline: true, alert_on_critical_offline: true, alert_on_online: true, alert_on_high_latency: false
    });

    const [polling, setPolling] = useState({
        ping_interval_ms: '60000', unifi_interval_ms: '300000', alert_cooldown_ms: '900000'
    });

    const [passwordForm, setPasswordForm] = useState({
        current_password: '', new_password: '', confirm_password: ''
    });

    // Fetch settings — use the returned data object directly (TanStack Query v5 removed onSuccess)
    const { data: settingsData } = useQuery({
        queryKey: ['settings'],
        queryFn: () => axios.get('/api/v1/settings').then(res => res.data),
    });

    // Populate forms whenever settings data loads
    useEffect(() => {
        const s = settingsData?.settings;
        if (!s) return;

        setUnifi({
            unifi_url: s.unifi_url || '',
            unifi_username: s.unifi_username || '',
            // Show masked placeholder if a password is stored, but keep it editable
            unifi_password: s.unifi_password || '',
            unifi_site: s.unifi_site || 'default',
            unifi_ssl_verify: s.unifi_ssl_verify === '1',
        });

        setEmail({
            smtp_host: s.smtp_host || '',
            smtp_port: s.smtp_port || '587',
            smtp_secure: s.smtp_secure === '1',
            smtp_user: s.smtp_user || '',
            smtp_pass: s.smtp_pass || '',
            alert_from: s.alert_from || '',
            alert_to: s.alert_to || '',
            alert_on_offline: s.alert_on_offline !== '0',
            alert_on_critical_offline: s.alert_on_critical_offline !== '0',
            alert_on_online: s.alert_on_online !== '0',
            alert_on_high_latency: s.alert_on_high_latency === '1',
        });

        setPolling({
            ping_interval_ms: s.ping_interval_ms || '60000',
            unifi_interval_ms: s.unifi_interval_ms || '300000',
            alert_cooldown_ms: s.alert_cooldown_ms || '900000',
        });
    }, [settingsData]);

    const showToast = (message, severity = 'success') => {
        setToast({ open: true, message, severity });
    };

    // Mutations
    const saveUnifi = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/unifi', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            showToast('UniFi settings saved successfully');
        }
    });

    const saveEmail = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/email', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            showToast('Email settings saved successfully');
        }
    });

    const savePolling = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/polling', data),
        onSuccess: () => showToast('Polling settings saved. Jobs restarted.')
    });

    const changePassword = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/password', data),
        onSuccess: () => {
            showToast('Password changed successfully');
            setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
        },
        onError: (err) => showToast(err.response?.data?.message || 'Failed to change password', 'error')
    });

    const testUnifi = useMutation({
        mutationFn: () => axios.post('/api/v1/settings/test-unifi'),
        onMutate: () => setUnifiStatus('testing'),
        onSuccess: (res) => {
            setUnifiStatus('connected');
            showToast(res.data.message);
        },
        onError: (err) => {
            setUnifiStatus('error');
            showToast(err.response?.data?.message || 'Connection failed', 'error');
        }
    });

    const testEmail = useMutation({
        mutationFn: () => axios.post('/api/v1/settings/test-email'),
        onSuccess: (res) => showToast(res.data.message),
        onError: (err) => showToast(err.response?.data?.message || 'Failed to send test email', 'error')
    });

    const handlePasswordSubmit = (e) => {
        e.preventDefault();
        if (passwordForm.new_password !== passwordForm.confirm_password) {
            showToast('New passwords do not match', 'error');
            return;
        }
        changePassword.mutate({
            current_password: passwordForm.current_password,
            new_password: passwordForm.new_password
        });
    };

    // Determine if a password placeholder is being shown (masked by backend)
    const isUnifiPasswordMasked = unifi.unifi_password === '••••••••';

    return (
        <Box>
            <Typography variant="h4" fontWeight="bold" gutterBottom>Settings</Typography>

            <Card sx={{ mt: 3 }}>
                <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Tabs value={tabIndex} onChange={(e, v) => setTabIndex(v)} aria-label="settings tabs">
                        <Tab label={
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                UniFi Controller
                                <UnifiStatusChip status={unifiStatus} />
                            </Box>
                        } />
                        <Tab label="Email Alerts" />
                        <Tab label="Polling Intervals" />
                        <Tab label="Account" />
                    </Tabs>
                </Box>

                {/* UNIFI TAB */}
                <TabPanel value={tabIndex} index={0}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>UniFi Controller Configuration</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Connect to your UniFi Network application to pull client/bandwidth data.
                            The user provided needs API access (read-only is sufficient).
                        </Typography>

                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth label="Controller URL (e.g. https://192.168.1.6)"
                                    value={unifi.unifi_url}
                                    onChange={(e) => setUnifi({ ...unifi, unifi_url: e.target.value })}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth label="Username"
                                    value={unifi.unifi_username}
                                    onChange={(e) => setUnifi({ ...unifi, unifi_username: e.target.value })}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    label="Password"
                                    type={showPassword ? 'text' : 'password'}
                                    value={unifi.unifi_password}
                                    placeholder={isUnifiPasswordMasked ? 'Password saved — enter new to change' : ''}
                                    onChange={(e) => setUnifi({ ...unifi, unifi_password: e.target.value })}
                                    helperText={isUnifiPasswordMasked ? 'A password is already saved.' : ''}
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth label="Site Name"
                                    value={unifi.unifi_site}
                                    onChange={(e) => setUnifi({ ...unifi, unifi_site: e.target.value })}
                                    helperText="Usually 'default'"
                                />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <FormControlLabel
                                    control={<Switch checked={unifi.unifi_ssl_verify} onChange={(e) => setUnifi({ ...unifi, unifi_ssl_verify: e.target.checked })} />}
                                    label="Verify SSL Certificate"
                                />
                                <Typography variant="caption" display="block" color="text.secondary">
                                    If using a self-signed cert on UDM, leave this unchecked.
                                </Typography>
                            </Grid>

                            {/* Connection status info box */}
                            {unifi.unifi_url && (
                                <Grid item xs={12}>
                                    <Box sx={{
                                        p: 2, borderRadius: 1,
                                        bgcolor: unifiStatus === 'connected' ? 'success.main' : unifiStatus === 'error' ? 'error.main' : 'rgba(255,255,255,0.05)',
                                        opacity: unifiStatus ? 1 : 0.7,
                                        display: 'flex', alignItems: 'center', gap: 1
                                    }}>
                                        {unifiStatus === 'connected' && <ConnectedIcon fontSize="small" />}
                                        {unifiStatus === 'error' && <ErrorIcon fontSize="small" />}
                                        {!unifiStatus && <UnknownIcon fontSize="small" />}
                                        <Typography variant="body2">
                                            {unifiStatus === 'connected' && `Connected to ${unifi.unifi_url}`}
                                            {unifiStatus === 'error' && 'Could not connect — check your URL and credentials'}
                                            {unifiStatus === 'testing' && 'Testing connection…'}
                                            {!unifiStatus && `Target: ${unifi.unifi_url} — click "Test Connection" to verify`}
                                        </Typography>
                                    </Box>
                                </Grid>
                            )}
                        </Grid>

                        <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveUnifi.mutate(unifi)} disabled={saveUnifi.isPending}>
                                {saveUnifi.isPending ? 'Saving…' : 'Save Settings'}
                            </Button>
                            <Button variant="outlined" startIcon={<TestIcon />} onClick={() => testUnifi.mutate()} disabled={testUnifi.isPending}>
                                {testUnifi.isPending ? 'Testing…' : 'Test Connection'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* EMAIL TAB */}
                <TabPanel value={tabIndex} index={1}>
                    <Box sx={{ p: 4, maxWidth: 800 }}>
                        <Typography variant="h6" gutterBottom>SMTP Email Server</Typography>
                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} sm={8}>
                                <TextField fullWidth label="SMTP Host" value={email.smtp_host} onChange={(e) => setEmail({ ...email, smtp_host: e.target.value })} />
                            </Grid>
                            <Grid item xs={12} sm={4}>
                                <TextField fullWidth label="SMTP Port" value={email.smtp_port} onChange={(e) => setEmail({ ...email, smtp_port: e.target.value })} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="SMTP Username" value={email.smtp_user} onChange={(e) => setEmail({ ...email, smtp_user: e.target.value })} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth label="SMTP Password" type="password"
                                    value={email.smtp_pass}
                                    helperText={email.smtp_pass === '••••••••' ? 'A password is already saved.' : ''}
                                    onChange={(e) => setEmail({ ...email, smtp_pass: e.target.value })}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <FormControlLabel
                                    control={<Switch checked={email.smtp_secure} onChange={(e) => setEmail({ ...email, smtp_secure: e.target.checked })} />}
                                    label="Use TLS/SSL (Secure)"
                                />
                            </Grid>
                        </Grid>

                        {/* Recipients */}
                        <Typography variant="h6" gutterBottom>Email Addresses</Typography>
                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="From Address" value={email.alert_from} onChange={(e) => setEmail({ ...email, alert_from: e.target.value })} />
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField fullWidth label="To Address(es)" helperText="Comma separated" value={email.alert_to} onChange={(e) => setEmail({ ...email, alert_to: e.target.value })} />
                            </Grid>
                        </Grid>

                        {/* Triggers */}
                        <Typography variant="h6" gutterBottom>Alert Triggers To Send Email</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 4 }}>
                            <FormControlLabel control={<Checkbox checked={email.alert_on_offline} onChange={(e) => setEmail({ ...email, alert_on_offline: e.target.checked })} />} label="Any device goes offline" />
                            <FormControlLabel control={<Checkbox checked={email.alert_on_critical_offline} onChange={(e) => setEmail({ ...email, alert_on_critical_offline: e.target.checked })} />} label="Critical device goes offline" />
                            <FormControlLabel control={<Checkbox checked={email.alert_on_online} onChange={(e) => setEmail({ ...email, alert_on_online: e.target.checked })} />} label="Device comes back online" />
                            <FormControlLabel control={<Checkbox checked={email.alert_on_high_latency} onChange={(e) => setEmail({ ...email, alert_on_high_latency: e.target.checked })} />} label="High latency detected (>200ms)" />
                        </Box>

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveEmail.mutate(email)} disabled={saveEmail.isPending}>
                                {saveEmail.isPending ? 'Saving…' : 'Save Settings'}
                            </Button>
                            <Button variant="outlined" startIcon={<TestIcon />} onClick={() => testEmail.mutate()} disabled={testEmail.isPending}>
                                {testEmail.isPending ? 'Sending…' : 'Send Test Email'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* POLLING TAB */}
                <TabPanel value={tabIndex} index={2}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>Background Jobs Configuration</Typography>
                        <Grid container spacing={4}>
                            <Grid item xs={12}>
                                <TextField
                                    select fullWidth label="ICMP Ping Interval" helperText="How often to ping all devices in the database"
                                    value={polling.ping_interval_ms} onChange={(e) => setPolling({ ...polling, ping_interval_ms: e.target.value })}
                                >
                                    <MenuItem value="30000">30 Seconds</MenuItem>
                                    <MenuItem value="60000">1 Minute</MenuItem>
                                    <MenuItem value="120000">2 Minutes</MenuItem>
                                    <MenuItem value="300000">5 Minutes</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    select fullWidth label="UniFi Data Refresh Interval" helperText="How often to pull updated data from UniFi API"
                                    value={polling.unifi_interval_ms} onChange={(e) => setPolling({ ...polling, unifi_interval_ms: e.target.value })}
                                >
                                    <MenuItem value="60000">1 Minute</MenuItem>
                                    <MenuItem value="300000">5 Minutes</MenuItem>
                                    <MenuItem value="900000">15 Minutes</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    select fullWidth label="Alert Cooldown" helperText="Prevents spamming duplicate alerts if a device flaps up/down"
                                    value={polling.alert_cooldown_ms} onChange={(e) => setPolling({ ...polling, alert_cooldown_ms: e.target.value })}
                                >
                                    <MenuItem value="300000">5 Minutes</MenuItem>
                                    <MenuItem value="900000">15 Minutes</MenuItem>
                                    <MenuItem value="1800000">30 Minutes</MenuItem>
                                    <MenuItem value="3600000">1 Hour</MenuItem>
                                </TextField>
                            </Grid>
                        </Grid>
                        <Box sx={{ mt: 4 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => savePolling.mutate(polling)} disabled={savePolling.isPending}>
                                {savePolling.isPending ? 'Saving…' : 'Save and Restart Jobs'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* ACCOUNT TAB */}
                <TabPanel value={tabIndex} index={3}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>Admin Account</Typography>
                        <Box sx={{ mb: 4, p: 2, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1 }}>
                            <Typography variant="body2" color="text.secondary">Current User Email</Typography>
                            <Typography variant="body1">{user?.email}</Typography>
                        </Box>

                        <Typography variant="h6" gutterBottom>Change Password</Typography>
                        <form onSubmit={handlePasswordSubmit}>
                            <TextField
                                fullWidth label="Current Password" type="password" margin="normal" required
                                value={passwordForm.current_password} onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                            />
                            <TextField
                                fullWidth label="New Password" type="password" margin="normal" required
                                value={passwordForm.new_password} onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                            />
                            <TextField
                                fullWidth label="Confirm New Password" type="password" margin="normal" required
                                value={passwordForm.confirm_password} onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                            />
                            <Box sx={{ mt: 2 }}>
                                <Button variant="contained" type="submit" disabled={changePassword.isPending}>
                                    {changePassword.isPending ? 'Updating…' : 'Update Password'}
                                </Button>
                            </Box>
                        </form>
                    </Box>
                </TabPanel>
            </Card>

            <Snackbar
                open={toast.open}
                autoHideDuration={4000}
                onClose={() => setToast(prev => ({ ...prev, open: false }))}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
            >
                <Alert severity={toast.severity} sx={{ width: '100%' }}>
                    {toast.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
