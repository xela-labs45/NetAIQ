import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Box, Typography, Button, TextField, Grid, Card, Checkbox, Switch,
    FormControlLabel, Tabs, Tab, Alert, Snackbar, InputAdornment, IconButton,
    MenuItem, Chip, CircularProgress, Tooltip
} from '@mui/material';
import {
    Visibility, VisibilityOff, Save as SaveIcon, PlayArrow as TestIcon,
    CheckCircle as ConnectedIcon, Error as ErrorIcon, HelpOutline as UnknownIcon,
    AutoAwesome as AiIcon, Refresh as RefreshIcon, Storage as StorageIcon, Send as TelegramIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useAuth } from '../hooks/useAuth';
import Autocomplete from '@mui/material/Autocomplete';

function TabPanel(props) {
    const { children, value, index, ...other } = props;
    return (
        <div role="tabpanel" hidden={value !== index} {...other} style={{ paddingTop: '24px' }}>
            {value === index && children}
        </div>
    );
}

function UnifiStatusChip({ status }) {
    if (status === 'connected') return <Chip icon={<ConnectedIcon />} label="Connected" color="success" size="small" sx={{ ml: 1 }} />;
    if (status === 'error') return <Chip icon={<ErrorIcon />} label="Error" color="error" size="small" sx={{ ml: 1 }} />;
    if (status === 'testing') return <Chip icon={<CircularProgress size={12} />} label="Testing…" size="small" sx={{ ml: 1 }} />;
    return null;
}

function AiStatusChip({ status }) {
    if (status === 'connected') return <Chip icon={<ConnectedIcon />} label="Ready" color="success" size="small" sx={{ ml: 1 }} />;
    if (status === 'error') return <Chip icon={<ErrorIcon />} label="Error" color="error" size="small" sx={{ ml: 1 }} />;
    if (status === 'testing') return <Chip icon={<CircularProgress size={12} />} label="Testing…" size="small" sx={{ ml: 1 }} />;
    return null;
}

export default function Settings() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const location = useLocation();
    const [tabIndex, setTabIndex] = useState(0);
    const [showPassword, setShowPassword] = useState(false);
    const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
    const [unifiStatus, setUnifiStatus] = useState(null); // null | 'testing' | 'connected' | 'error'
    const [aiStatus, setAiStatus] = useState(null); // null | 'testing' | 'connected' | 'error'
    const [telegramStatus, setTelegramStatus] = useState(null); // null | 'testing' | 'connected' | 'error'

    // Forms state
    const [unifi, setUnifi] = useState({
        unifi_url: '', unifi_username: '', unifi_password: '', unifi_site: 'default', unifi_ssl_verify: false
    });

    const [email, setEmail] = useState({
        smtp_host: '', smtp_port: '587', smtp_secure: false, smtp_user: '', smtp_pass: '',
        alert_from: '', alert_to: '',
        alert_on_critical_offline: true, alert_on_critical_online: true, alert_on_high_latency: false,
        email_alert_ap_offline: false, email_alert_ap_online: false,
        email_alert_segment_offline: false,
        email_offline_grace_minutes: '0',
    });

    const [telegram, setTelegram] = useState({
        telegram_bot_token: '', telegram_chat_id: '', telegram_alerts_enabled: false, telegram_ai_enhanced: false,
        telegram_alert_critical_offline: true, telegram_alert_critical_online: true,
        telegram_alert_ap_offline: true, telegram_alert_ap_online: true,
        telegram_alert_segment_offline: true,
        telegram_offline_grace_minutes: '0',
    });

    const [general, setGeneral] = useState({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    // Handle deep-linking to specific tabs (FIX 7)
    useEffect(() => {
        if (location.state?.tab !== undefined) {
            setTabIndex(location.state.tab);
            // Clear the state so it doesn't stay on refresh or back/forward
            window.history.replaceState({}, document.title);
        }
    }, [location]);


    const [polling, setPolling] = useState({
        critical_ping_interval: '120', segment_scan_interval: '900', unifi_interval_ms: '300000', alert_cooldown_ms: '900000',
        ping_history_retention_days: '90', alert_cooldown_minutes: '15', alert_retention_days: '180'
    });

    const [ai, setAi] = useState({
        ai_provider: 'anthropic',
        ai_anthropic_key: '',
        ai_openrouter_key: '',
        ai_model: 'claude-3-5-sonnet-20241022',
        ai_system_prompt: '',
        ai_identify_interval_ms: '3600000',
        ai_analysis_interval_ms: '21600000',
        ai_enabled: true
    });

    const [passwordForm, setPasswordForm] = useState({
        current_password: '', new_password: '', confirm_password: ''
    });

    // Open the correct tab and show a toast if the router passed navigation state
    useEffect(() => {
        if (location.state?.tab !== undefined) setTabIndex(location.state.tab);
        if (location.state?.toast) showToast(location.state.toast, 'warning');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fetch settings — use the returned data object directly (TanStack Query v5 removed onSuccess)
    const { data: settingsData } = useQuery({
        queryKey: ['settings'],
        queryFn: () => axios.get('/api/v1/settings').then(res => res.data),
    });

    // Fetch table row counts for data retention display
    const { data: tableCounts } = useQuery({
        queryKey: ['tableCounts'],
        queryFn: () => axios.get('/api/v1/settings/table-counts').then(res => res.data),
        staleTime: 60000,
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
            alert_on_critical_offline: s.alert_on_critical_offline !== '0',
            alert_on_critical_online: s.alert_on_critical_online !== '0',
            alert_on_high_latency: s.alert_on_high_latency === '1',
            email_alert_ap_offline: s.email_alert_ap_offline === '1',
            email_alert_ap_online: s.email_alert_ap_online === '1',
            email_alert_segment_offline: s.email_alert_segment_offline === '1',
            email_offline_grace_minutes: s.email_offline_grace_minutes || '0',
        });

        setTelegram({
            telegram_bot_token: s.telegram_bot_token || '',
            telegram_chat_id: s.telegram_chat_id || '',
            telegram_alerts_enabled: s.telegram_alerts_enabled === '1',
            telegram_ai_enhanced: s.telegram_ai_enhanced === '1',
            telegram_alert_critical_offline: s.telegram_alert_critical_offline !== '0',
            telegram_alert_critical_online: s.telegram_alert_critical_online !== '0',
            telegram_alert_ap_offline: s.telegram_alert_ap_offline !== '0',
            telegram_alert_ap_online: s.telegram_alert_ap_online !== '0',
            telegram_alert_segment_offline: s.telegram_alert_segment_offline !== '0',
            telegram_offline_grace_minutes: s.telegram_offline_grace_minutes || '0',
        });

        setPolling({
            critical_ping_interval: s.critical_ping_interval || '120',
            segment_scan_interval: s.segment_scan_interval || '900',
            unifi_interval_ms: s.unifi_interval_ms || '300000',
            alert_cooldown_ms: s.alert_cooldown_ms || '900000',
            ping_history_retention_days: s.ping_history_retention_days || '90',
            alert_cooldown_minutes: s.alert_cooldown_minutes || '15',
            alert_retention_days: s.alert_retention_days || '180',
        });

        setAi({
            ai_provider: s.ai_provider || 'anthropic',
            ai_anthropic_key: s.ai_anthropic_key || '',
            ai_openrouter_key: s.ai_openrouter_key || '',
            ai_model: s.ai_model || 'claude-3-5-sonnet-20241022',
            ai_system_prompt: s.ai_system_prompt || 'You are an expert IT network administrator. Analyze this network data.',
            ai_identify_interval_ms: s.ai_identify_interval_ms || '3600000', // 1 hour
            ai_analysis_interval_ms: s.ai_analysis_interval_ms || '21600000', // 6 hours
            ai_enabled: s.ai_enabled !== '0'
        });

        setGeneral({
            timezone: s.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
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

    const saveTelegram = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/telegram', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            showToast('Telegram settings saved successfully');
        }
    });

    const saveGeneral = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/general', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            showToast('General settings saved successfully');
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
        mutationFn: () => axios.post('/api/v1/settings/test-unifi', unifi),
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
        mutationFn: () => axios.post('/api/v1/settings/test-email', email),
        onSuccess: (res) => showToast(res.data.message),
        onError: (err) => showToast(err.response?.data?.message || 'Failed to send test email', 'error')
    });

    const testTelegram = useMutation({
        mutationFn: () => axios.post('/api/v1/settings/telegram/test', {
            telegram_bot_token: telegram.telegram_bot_token,
            telegram_chat_id: telegram.telegram_chat_id,
        }),
        onMutate: () => setTelegramStatus('testing'),
        onSuccess: (res) => {
            setTelegramStatus('connected');
            showToast(res.data.message);
        },
        onError: (err) => {
            setTelegramStatus('error');
            showToast(err.response?.data?.message || 'Failed to send test telegram', 'error');
        }
    });

    const saveAi = useMutation({
        mutationFn: (data) => axios.put('/api/v1/settings/ai', data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['settings'] });
            showToast('AI Settings saved. Jobs restarted.');
        }
    });

    const testAi = useMutation({
        mutationFn: () => {
            const key = ai.ai_provider === 'anthropic' ? ai.ai_anthropic_key : ai.ai_openrouter_key;
            return axios.post('/api/v1/ai/test-connection', {
                provider: ai.ai_provider,
                api_key: key && !key.startsWith('sk-ant-*') && !key.startsWith('sk-or-*') ? key : undefined,
                model: ai.ai_model
            });
        },
        onMutate: () => setAiStatus('testing'),
        onSuccess: (res) => {
            setAiStatus('connected');
            showToast(res.data.message || 'AI Connection successful');
        },
        onError: (err) => {
            setAiStatus('error');
            showToast(err.response?.data?.error || 'AI Connection failed', 'error');
        }
    });

    const { data: modelsData, isLoading: isLoadingModels, refetch: refetchModels } = useQuery({
        queryKey: ['aiModels', ai.ai_provider],
        queryFn: () => {
            const key = ai.ai_provider === 'anthropic' ? ai.ai_anthropic_key : ai.ai_openrouter_key;
            return axios.get('/api/v1/ai/models', {
                params: {
                    provider: ai.ai_provider,
                    api_key: key && key !== 'sk-***' ? key : undefined
                }
            }).then(res => res.data);
        },
        enabled: (!!ai.ai_anthropic_key || !!ai.ai_openrouter_key) && !!ai.ai_provider,
        staleTime: 600000, // 10 mins
    });

    const { data: pollingStatus } = useQuery({
        queryKey: ['pollingStatus'],
        queryFn: () => axios.get('/api/v1/settings/polling-status').then(res => res.data),
        refetchInterval: 5000,
        enabled: tabIndex === 5
    });

    const { data: aiStatusData } = useQuery({
        queryKey: ['aiStatus'],
        queryFn: () => axios.get('/api/v1/ai/status').then(res => res.data),
        retry: false,
        refetchOnWindowFocus: false
    });

    useEffect(() => {
        if (!aiStatusData) return;
        if (aiStatusData.status === 'ok') setAiStatus('connected');
        else if (aiStatusData.status === 'error') setAiStatus('error');
    }, [aiStatusData]);

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
                        <Tab label="General" />
                        <Tab label={
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                UniFi Controller
                                <UnifiStatusChip status={unifiStatus} />
                            </Box>
                        } />
                        <Tab label="Email Alerts" />
                        <Tab label={
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                Telegram
                                <UnifiStatusChip status={telegramStatus} />
                            </Box>
                        } />
                        <Tab label={
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                AI Insights
                                <AiStatusChip status={aiStatus} />
                            </Box>
                        } />
                        <Tab label="Polling Intervals" />
                        <Tab label="Account" />
                    </Tabs>
                </Box>

                {/* GENERAL TAB */}
                <TabPanel value={tabIndex} index={0}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>General Settings</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                            Configure system-wide localization and identification settings.
                        </Typography>

                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <Autocomplete
                                    options={Intl.supportedValuesOf('timeZone')}
                                    value={general.timezone}
                                    onChange={(e, newValue) => setGeneral({ ...general, timezone: newValue })}
                                    renderInput={(params) => (
                                        <TextField 
                                            {...params} 
                                            label="System Timezone" 
                                            helperText="Used for Telegram and Email notification timestamps."
                                        />
                                    )}
                                />
                            </Grid>
                        </Grid>

                        <Box sx={{ mt: 4 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveGeneral.mutate(general)} disabled={saveGeneral.isPending}>
                                {saveGeneral.isPending ? 'Saving…' : 'Save Settings'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* UNIFI TAB */}
                <TabPanel value={tabIndex} index={1}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>UniFi Controller Configuration</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Connect to your UniFi Network application to pull client/bandwidth data.
                            The user provided needs API access (read-only is sufficient).
                        </Typography>

                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth label="Controller URL"
                                    placeholder="https://192.168.1.6:8443"
                                    helperText="Include the port — UDM uses 443, legacy USG/CloudKey use 8443, some controllers use 11443"
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
                <TabPanel value={tabIndex} index={2}>
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

                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Device Alerts</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3, pl: 1 }}>
                            <FormControlLabel control={<Checkbox checked={email.alert_on_critical_offline} onChange={(e) => setEmail({ ...email, alert_on_critical_offline: e.target.checked })} />} label="Critical device goes offline" />
                            <FormControlLabel control={<Checkbox checked={email.alert_on_critical_online} onChange={(e) => setEmail({ ...email, alert_on_critical_online: e.target.checked })} />} label="Critical device comes back online" />
                            <FormControlLabel control={<Checkbox checked={email.alert_on_high_latency} onChange={(e) => setEmail({ ...email, alert_on_high_latency: e.target.checked })} />} label="High latency detected (>200ms)" />
                        </Box>

                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>UniFi / AP Alerts</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3, pl: 1 }}>
                            <FormControlLabel control={<Checkbox checked={email.email_alert_ap_offline} onChange={(e) => setEmail({ ...email, email_alert_ap_offline: e.target.checked })} />} label="Access point goes offline" />
                            <FormControlLabel control={<Checkbox checked={email.email_alert_ap_online} onChange={(e) => setEmail({ ...email, email_alert_ap_online: e.target.checked })} />} label="Access point comes back online" />
                        </Box>

                        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Network Segment Alerts</Typography>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 4, pl: 1 }}>
                            <FormControlLabel control={<Checkbox checked={email.email_alert_segment_offline} onChange={(e) => setEmail({ ...email, email_alert_segment_offline: e.target.checked })} />} label="Segment scan returns no devices" />
                        </Box>

                        <Typography variant="h6" gutterBottom>Notification Timing</Typography>
                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label="Offline Grace Period (minutes)"
                                    value={email.email_offline_grace_minutes}
                                    onChange={(e) => setEmail({ ...email, email_offline_grace_minutes: e.target.value })}
                                    inputProps={{ min: 0, step: 1 }}
                                    helperText="Wait this many minutes before sending an email. If the device recovers within this window, no alert is sent. Set to 0 to alert immediately."
                                />
                            </Grid>
                        </Grid>

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

                {/* TELEGRAM TAB */}
                <TabPanel value={tabIndex} index={3}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>Telegram Bot Notifications</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                            Send real-time alerts to a Telegram chat or group when critical network events occur.
                        </Typography>

                        <FormControlLabel
                            sx={{ mb: 3 }}
                            control={<Switch checked={telegram.telegram_alerts_enabled} onChange={(e) => setTelegram({ ...telegram, telegram_alerts_enabled: e.target.checked })} color="primary" />}
                            label="Enable Telegram Notifications"
                        />

                        <Grid container spacing={3}>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth label="Bot Token"
                                    type={showPassword ? 'text' : 'password'}
                                    value={telegram.telegram_bot_token}
                                    placeholder={telegram.telegram_bot_token?.startsWith('••••••••') ? 'Token saved — enter new to change' : 'Enter your Telegram Bot Token'}
                                    onChange={(e) => setTelegram({ ...telegram, telegram_bot_token: e.target.value })}
                                    helperText={telegram.telegram_bot_token?.startsWith('••••••••') ? 'A token is already saved.' : 'Get your token from @BotFather on Telegram (e.g. 123456789:ABCdef...)'}
                                    InputProps={{
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton onClick={() => setShowPassword(!showPassword)} edge="end">
                                                    {showPassword ? <VisibilityOff /> : <Visibility />}
                                                </IconButton>
                                            </InputAdornment>
                                        )
                                    }}
                                    error={!!telegram.telegram_bot_token && !telegram.telegram_bot_token.includes(':') && !telegram.telegram_bot_token.startsWith('••••••••')}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth label="Chat ID"
                                    value={telegram.telegram_chat_id}
                                    placeholder="Enter your Chat ID"
                                    onChange={(e) => setTelegram({ ...telegram, telegram_chat_id: e.target.value })}
                                    helperText="Send /start to your bot then visit api.telegram.org/bot{TOKEN}/getUpdates to find your chat_id. Can be negative for groups."
                                    error={!!telegram.telegram_chat_id && isNaN(Number(telegram.telegram_chat_id))}
                                />
                            </Grid>
                            {/* Connection status info box */}
                            {telegramStatus && (
                                <Grid item xs={12}>
                                    <Box sx={{
                                        p: 2, borderRadius: 1,
                                        bgcolor: telegramStatus === 'connected' ? 'success.main' : telegramStatus === 'error' ? 'error.main' : 'rgba(255,255,255,0.05)',
                                        display: 'flex', alignItems: 'center', gap: 1
                                    }}>
                                        {telegramStatus === 'connected' && <ConnectedIcon fontSize="small" />}
                                        {telegramStatus === 'error' && <ErrorIcon fontSize="small" />}
                                        {telegramStatus === 'testing' && <CircularProgress size={16} />}
                                        <Typography variant="body2">
                                            {telegramStatus === 'connected' && 'Test message sent successfully'}
                                            {telegramStatus === 'error' && 'Failed to send message — check your Token and Chat ID'}
                                            {telegramStatus === 'testing' && 'Sending test message…'}
                                        </Typography>
                                    </Box>
                                </Grid>
                            )}
                        </Grid>

                        {/* Per-event toggles — only visible when Telegram is enabled */}
                        {telegram.telegram_alerts_enabled && (
                            <Box sx={{ mt: 3, p: 2.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.08)' }}>
                                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>Alert Event Selection</Typography>

                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Device Alerts</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2, pl: 1 }}>
                                    <FormControlLabel
                                        control={<Checkbox size="small" checked={telegram.telegram_alert_critical_offline} onChange={(e) => setTelegram({ ...telegram, telegram_alert_critical_offline: e.target.checked })} />}
                                        label={<Typography variant="body2">Critical device goes offline</Typography>}
                                    />
                                    <FormControlLabel
                                        control={<Checkbox size="small" checked={telegram.telegram_alert_critical_online} onChange={(e) => setTelegram({ ...telegram, telegram_alert_critical_online: e.target.checked })} />}
                                        label={<Typography variant="body2">Critical device comes back online</Typography>}
                                    />
                                </Box>

                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>UniFi / AP Alerts</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 2, pl: 1 }}>
                                    <FormControlLabel
                                        control={<Checkbox size="small" checked={telegram.telegram_alert_ap_offline} onChange={(e) => setTelegram({ ...telegram, telegram_alert_ap_offline: e.target.checked })} />}
                                        label={<Typography variant="body2">Access point goes offline</Typography>}
                                    />
                                    <FormControlLabel
                                        control={<Checkbox size="small" checked={telegram.telegram_alert_ap_online} onChange={(e) => setTelegram({ ...telegram, telegram_alert_ap_online: e.target.checked })} />}
                                        label={<Typography variant="body2">Access point comes back online</Typography>}
                                    />
                                </Box>

                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>Network Segment Alerts</Typography>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pl: 1 }}>
                                    <FormControlLabel
                                        control={<Checkbox size="small" checked={telegram.telegram_alert_segment_offline} onChange={(e) => setTelegram({ ...telegram, telegram_alert_segment_offline: e.target.checked })} />}
                                        label={<Typography variant="body2">Segment scan returns no devices</Typography>}
                                    />
                                </Box>
                            </Box>
                        )}

                        {/* Grace period — only visible when Telegram is enabled */}
                        {telegram.telegram_alerts_enabled && (
                            <Box sx={{ mt: 3, p: 2.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.08)' }}>
                                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>Notification Timing</Typography>
                                <TextField
                                    fullWidth
                                    type="number"
                                    label="Offline Grace Period (minutes)"
                                    value={telegram.telegram_offline_grace_minutes}
                                    onChange={(e) => setTelegram({ ...telegram, telegram_offline_grace_minutes: e.target.value })}
                                    inputProps={{ min: 0, step: 1 }}
                                    helperText="Wait this many minutes before sending a Telegram alert. If the device recovers within this window, no message is sent. Set to 0 to alert immediately."
                                />
                            </Box>
                        )}

                        {/* AI-Enhanced Alerts — only visible when Telegram is enabled */}
                        {telegram.telegram_alerts_enabled && (
                            <Box sx={{ mt: 3, p: 2.5, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1, border: '1px solid rgba(255,255,255,0.08)' }}>
                                <FormControlLabel
                                    control={<Switch checked={telegram.telegram_ai_enhanced} onChange={(e) => setTelegram({ ...telegram, telegram_ai_enhanced: e.target.checked })} color="primary" />}
                                    label="AI-Enhanced Alerts"
                                />
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 5.8, mt: -0.5 }}>
                                    Uses your configured AI provider to suggest immediate action steps for each alert. Requires a valid AI API key in AI Settings.
                                </Typography>
                                {telegram.telegram_ai_enhanced && (() => {
                                    const hasKey = ai.ai_provider === 'openrouter'
                                        ? !!ai.ai_openrouter_key && !ai.ai_openrouter_key.startsWith('sk-or-*')
                                        : !!ai.ai_anthropic_key && !ai.ai_anthropic_key.startsWith('sk-ant-*');
                                    if (!hasKey) return (
                                        <Box sx={{ mt: 1.5, ml: 5.8, display: 'flex', alignItems: 'center', gap: 1, p: 1, borderRadius: 1, bgcolor: 'rgba(255,152,0,0.1)', border: '1px solid rgba(255,152,0,0.3)' }}>
                                            <ErrorIcon fontSize="small" sx={{ color: 'warning.main' }} />
                                            <Typography variant="body2" sx={{ color: 'warning.main' }}>
                                                AI API key not configured. <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setTabIndex(4)}>Go to AI Settings</span>.
                                            </Typography>
                                        </Box>
                                    );
                                    return null;
                                })()}
                            </Box>
                        )}

                        <Box sx={{ mt: 4, display: 'flex', gap: 2 }}>
                            {(() => {
                                const hasKey = ai.ai_provider === 'openrouter'
                                    ? !!ai.ai_openrouter_key && !ai.ai_openrouter_key.startsWith('sk-or-*')
                                    : !!ai.ai_anthropic_key && !ai.ai_anthropic_key.startsWith('sk-ant-*');
                                const isMissingKey = telegram.telegram_ai_enhanced && !hasKey;
                                const isMissingTelegramCreds = telegram.telegram_alerts_enabled && (!telegram.telegram_bot_token || !telegram.telegram_chat_id);
                                const isDisabled = saveTelegram.isPending || isMissingTelegramCreds || isMissingKey;

                                const button = (
                                    <Button 
                                        variant="contained" 
                                        startIcon={<SaveIcon />} 
                                        onClick={() => saveTelegram.mutate(telegram)} 
                                        disabled={isDisabled}
                                    >
                                        {saveTelegram.isPending ? 'Saving…' : 'Save Settings'}
                                    </Button>
                                );

                                if (isMissingKey) {
                                    return (
                                        <Tooltip title="Configure an AI API key in AI Settings first" placement="top">
                                            <span>{button}</span>
                                        </Tooltip>
                                    );
                                }
                                return button;
                            })()}
                            
                            <Button 
                                variant="outlined" 
                                startIcon={<TestIcon />} 
                                onClick={() => testTelegram.mutate()} 
                                disabled={testTelegram.isPending || !telegram.telegram_bot_token || !telegram.telegram_chat_id}
                            >
                                {testTelegram.isPending ? 'Sending…' : 'Test Notification'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* AI TAB */}
                <TabPanel value={tabIndex} index={4}>
                    <Box sx={{ p: 4, maxWidth: 800 }}>
                        <Typography variant="h6" gutterBottom>AI Assistant Configuration</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                            Configure the AI provider and models used for intelligent device identification and anomaly detection.
                        </Typography>

                        <FormControlLabel
                            sx={{ mb: 3 }}
                            control={<Switch checked={ai.ai_enabled} onChange={(e) => setAi({ ...ai, ai_enabled: e.target.checked })} color="primary" />}
                            label="Enable AI Insights (Background Jobs)"
                        />

                        <Grid container spacing={3} sx={{ mb: 4 }}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="AI Provider"
                                    value={ai.ai_provider}
                                    onChange={(e) => setAi({ ...ai, ai_provider: e.target.value })}
                                >
                                    <MenuItem value="anthropic">Anthropic (Claude)</MenuItem>
                                    <MenuItem value="openrouter">OpenRouter</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <Autocomplete
                                    freeSolo
                                    options={modelsData?.models || []}
                                    getOptionLabel={(option) => typeof option === 'string' ? option : option.label || option.id}
                                    value={ai.ai_model}
                                    onChange={(e, newValue) => {
                                        const val = typeof newValue === 'string' ? newValue : newValue?.id;
                                        if (val) setAi({ ...ai, ai_model: val });
                                    }}
                                    onInputChange={(e, newInputValue) => {
                                        setAi({ ...ai, ai_model: newInputValue });
                                    }}
                                    renderInput={(params) => (
                                        <TextField
                                            {...params}
                                            fullWidth label="Model Name"
                                            helperText={modelsData?.fallback ? "Provider API failed, using fallbacks." : (isLoadingModels ? "Loading models..." : "Select or type a model ID")}
                                            InputProps={{
                                                ...params.InputProps,
                                                endAdornment: (
                                                    <React.Fragment>
                                                        {isLoadingModels ? <CircularProgress color="inherit" size={20} /> : (
                                                            <IconButton size="small" onClick={() => refetchModels()} title="Refresh model list">
                                                                <RefreshIcon fontSize="small" />
                                                            </IconButton>
                                                        )}
                                                        {params.InputProps.endAdornment}
                                                    </React.Fragment>
                                                ),
                                            }}
                                        />
                                    )}
                                />
                            </Grid>
                            <Grid item xs={12}>
                                {ai.ai_provider === 'anthropic' ? (
                                    <TextField
                                        fullWidth label="Anthropic API Key" type="password"
                                        value={ai.ai_anthropic_key}
                                        onChange={(e) => setAi({ ...ai, ai_anthropic_key: e.target.value })}
                                        placeholder={ai.ai_anthropic_key?.startsWith('sk-ant-*') ? 'Key saved — enter new to change' : ''}
                                        helperText={ai.ai_anthropic_key?.startsWith('sk-ant-*') ? 'An API key is already saved.' : 'Starts with sk-ant-'}
                                    />
                                ) : (
                                    <TextField
                                        fullWidth label="OpenRouter API Key" type="password"
                                        value={ai.ai_openrouter_key}
                                        onChange={(e) => setAi({ ...ai, ai_openrouter_key: e.target.value })}
                                        placeholder={ai.ai_openrouter_key?.startsWith('sk-or-*') ? 'Key saved — enter new to change' : ''}
                                        helperText={ai.ai_openrouter_key?.startsWith('sk-or-*') ? 'An API key is already saved.' : 'Starts with sk-or-v1-'}
                                    />
                                )}
                            </Grid>
                            <Grid item xs={12}>
                                <TextField
                                    fullWidth label="System Prompt (Optional)" multiline rows={3}
                                    value={ai.ai_system_prompt}
                                    onChange={(e) => setAi({ ...ai, ai_system_prompt: e.target.value })}
                                    helperText="Custom instructions for the AI on how to analyze the network."
                                />
                            </Grid>
                        </Grid>

                        <Typography variant="h6" gutterBottom>AI Background Jobs</Typography>
                        <Grid container spacing={4} sx={{ mb: 4 }}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="Device Identify Interval"
                                    value={ai.ai_identify_interval_ms}
                                    onChange={(e) => setAi({ ...ai, ai_identify_interval_ms: e.target.value })}
                                    helperText="How often to try identifying unknown devices"
                                >
                                    <MenuItem value="900000">15 Minutes</MenuItem>
                                    <MenuItem value="3600000">1 Hour</MenuItem>
                                    <MenuItem value="14400000">4 Hours</MenuItem>
                                    <MenuItem value="86400000">24 Hours</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="Anomaly Analysis Interval"
                                    value={ai.ai_analysis_interval_ms}
                                    onChange={(e) => setAi({ ...ai, ai_analysis_interval_ms: e.target.value })}
                                    helperText="How often to scan alerts & traffic for anomalies"
                                >
                                    <MenuItem value="3600000">1 Hour</MenuItem>
                                    <MenuItem value="21600000">6 Hours</MenuItem>
                                    <MenuItem value="43200000">12 Hours</MenuItem>
                                    <MenuItem value="86400000">24 Hours</MenuItem>
                                </TextField>
                            </Grid>
                        </Grid>

                        {/* Connection status info box */}
                        {aiStatus && (
                            <Box sx={{
                                p: 2, mb: 4, borderRadius: 1,
                                bgcolor: aiStatus === 'connected' ? 'success.main' : aiStatus === 'error' ? 'error.main' : 'rgba(255,255,255,0.05)',
                                display: 'flex', alignItems: 'center', gap: 1
                            }}>
                                {aiStatus === 'connected' && <ConnectedIcon fontSize="small" />}
                                {aiStatus === 'error' && <ErrorIcon fontSize="small" />}
                                {aiStatus === 'testing' && <CircularProgress size={16} />}
                                <Typography variant="body2">
                                    {aiStatus === 'connected' && `Successfully connected to ${ai.ai_provider} AI`}
                                    {aiStatus === 'error' && 'Failed to connect to AI API — check key, provider, and network'}
                                    {aiStatus === 'testing' && 'Testing AI API connection…'}
                                </Typography>
                            </Box>
                        )}

                        <Box sx={{ display: 'flex', gap: 2 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => saveAi.mutate(ai)} disabled={saveAi.isPending}>
                                {saveAi.isPending ? 'Saving…' : 'Save and Restart Jobs'}
                            </Button>
                            <Button variant="outlined" startIcon={<TestIcon />} onClick={() => testAi.mutate()} disabled={testAi.isPending || (!ai.ai_anthropic_key && !ai.ai_openrouter_key) || (ai.ai_anthropic_key?.startsWith('sk-ant-*') && ai.ai_openrouter_key?.startsWith('sk-or-*'))}>
                                {testAi.isPending ? 'Testing…' : 'Test Connection'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* POLLING TAB */}
                <TabPanel value={tabIndex} index={5}>
                    <Box sx={{ p: 4, maxWidth: 700 }}>
                        <Typography variant="h6" gutterBottom>Background Jobs Configuration</Typography>
                        <Grid container spacing={4}>
                            <Grid item xs={12}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>--- Critical Device Polling ---</Typography>
                                <TextField
                                    fullWidth type="number"
                                    label="Critical Device Check Interval (Seconds)" 
                                    helperText="How often to ping devices marked as critical. Recommended: 60-120 seconds."
                                    value={polling.critical_ping_interval} 
                                    onChange={(e) => setPolling({ ...polling, critical_ping_interval: e.target.value })}
                                    inputProps={{ min: 30, max: 600 }}
                                />
                                <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(255,152,0,0.1)', borderRadius: 1, border: '1px solid rgba(255,152,0,0.3)' }}>
                                    <Typography variant="body2" color="warning.main" fontWeight="bold">Escalating Poll (Automatic)</Typography>
                                    <Typography variant="body2" color="warning.main">
                                        When a critical device goes offline, polling automatically increases to every 30 seconds until the device recovers or 20 attempts are reached.
                                    </Typography>
                                </Box>
                            </Grid>
                            
                            <Grid item xs={12}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>--- Segment Scanning ---</Typography>
                                <TextField
                                    fullWidth type="number"
                                    label="Segment Scan Interval (Seconds)" 
                                    helperText="How often to scan all segments and ping non-critical devices. Recommended: 10-15 minutes (600-900s) for SMB networks."
                                    value={polling.segment_scan_interval} 
                                    onChange={(e) => setPolling({ ...polling, segment_scan_interval: e.target.value })}
                                    inputProps={{ min: 300, max: 3600 }}
                                />
                            </Grid>

                            <Grid item xs={12}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>--- UniFi Integration ---</Typography>
                                <TextField
                                    select fullWidth label="UniFi Data Refresh Interval" helperText="How often to pull updated data from UniFi API"
                                    value={polling.unifi_interval_ms} onChange={(e) => setPolling({ ...polling, unifi_interval_ms: e.target.value })}
                                >
                                    <MenuItem value="60000">1 Minute</MenuItem>
                                    <MenuItem value="120000">2 Minutes</MenuItem>
                                    <MenuItem value="300000">5 Minutes</MenuItem>
                                    <MenuItem value="600000">10 Minutes</MenuItem>
                                    <MenuItem value="900000">15 Minutes</MenuItem>
                                    <MenuItem value="1800000">30 Minutes</MenuItem>
                                    <MenuItem value="3600000">1 Hour</MenuItem>
                                </TextField>
                            </Grid>
                        </Grid>

                        {/* DATA RETENTION SECTION */}
                        <Box sx={{ mt: 5, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <StorageIcon color="primary" fontSize="small" />
                            <Typography variant="h6">Data Retention</Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                            Configure how long historical data is kept. Cleanup runs automatically in the background. Unresolved critical alerts are never deleted.
                        </Typography>
                        <Grid container spacing={4}>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="Ping History Retention"
                                    value={polling.ping_history_retention_days}
                                    onChange={(e) => setPolling({ ...polling, ping_history_retention_days: e.target.value })}
                                    helperText={tableCounts ? `${tableCounts.ping_history?.toLocaleString()} rows stored` : 'Cleanup runs daily at 2:00 AM'}
                                >
                                    <MenuItem value="30">30 Days</MenuItem>
                                    <MenuItem value="60">60 Days</MenuItem>
                                    <MenuItem value="90">90 Days</MenuItem>
                                    <MenuItem value="180">180 Days</MenuItem>
                                    <MenuItem value="365">1 Year</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="Alert Deduplication Cooldown"
                                    value={polling.alert_cooldown_minutes}
                                    onChange={(e) => setPolling({ ...polling, alert_cooldown_minutes: e.target.value })}
                                    helperText="Suppresses duplicate alerts (same device + type) within this window"
                                >
                                    <MenuItem value="5">5 Minutes</MenuItem>
                                    <MenuItem value="10">10 Minutes</MenuItem>
                                    <MenuItem value="15">15 Minutes</MenuItem>
                                    <MenuItem value="30">30 Minutes</MenuItem>
                                    <MenuItem value="60">1 Hour</MenuItem>
                                </TextField>
                            </Grid>
                            <Grid item xs={12} sm={6}>
                                <TextField
                                    select fullWidth label="Alert History Retention"
                                    value={polling.alert_retention_days}
                                    onChange={(e) => setPolling({ ...polling, alert_retention_days: e.target.value })}
                                    helperText={tableCounts ? `${tableCounts.alerts?.toLocaleString()} alerts stored` : 'Cleanup runs weekly Sunday at 3:00 AM'}
                                >
                                    <MenuItem value="30">30 Days</MenuItem>
                                    <MenuItem value="90">90 Days</MenuItem>
                                    <MenuItem value="180">180 Days</MenuItem>
                                    <MenuItem value="365">1 Year</MenuItem>
                                </TextField>
                            </Grid>
                        </Grid>

                        <Box sx={{ mt: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <Box>
                                <Button variant="contained" startIcon={<SaveIcon />} onClick={() => savePolling.mutate(polling)} disabled={savePolling.isPending}>
                                    {savePolling.isPending ? 'Saving…' : 'Save and Restart Jobs'}
                                </Button>
                            </Box>

                            <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1 }}>
                                <Typography variant="subtitle2" color="primary" sx={{ mb: 2 }}>--- Current Status Display ---</Typography>
                                {pollingStatus ? (
                                    <>
                                        <Typography variant="body2" sx={{ mb: 1 }}>
                                            <strong>Critical Poll:</strong> {pollingStatus.criticalPoll?.running ? 'Running' : 'Stopped'} — 
                                            next check: {
                                                pollingStatus.criticalPoll?.nextRunExpectedAt 
                                                    ? `${Math.max(0, Math.floor((pollingStatus.criticalPoll.nextRunExpectedAt - Date.now()) / 1000))}s`
                                                    : 'Unknown'
                                            }
                                        </Typography>
                                        <Typography variant="body2" sx={{ mb: 2 }}>
                                            <strong>Segment Scan:</strong> {pollingStatus.segmentScan?.running ? 'Running' : 'Stopped'} — 
                                            next check: {
                                                pollingStatus.segmentScan?.nextRunExpectedAt 
                                                    ? `${Math.max(0, Math.floor((pollingStatus.segmentScan.nextRunExpectedAt - Date.now()) / 1000))}s`
                                                    : 'Unknown'
                                            }
                                        </Typography>
                                        
                                        {pollingStatus.escalatingPolls && pollingStatus.escalatingPolls.length > 0 && (
                                            <Box sx={{ mt: 2, p: 2, bgcolor: 'rgba(255,152,0,0.1)', borderRadius: 1, border: '1px solid rgba(255,152,0,0.3)' }}>
                                                <Typography variant="body2" color="warning.main" fontWeight="bold" sx={{ mb: 1 }}>
                                                    ⚡ Escalating Poll Active:
                                                </Typography>
                                                <ul style={{ margin: 0, paddingLeft: 20 }}>
                                                    {pollingStatus.escalatingPolls.map(poll => (
                                                        <li key={poll.deviceId}>
                                                            <Typography variant="body2" color="warning.main">
                                                                {poll.name} (attempt {poll.attempts}/{poll.max})
                                                            </Typography>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </Box>
                                        )}
                                    </>
                                ) : (
                                    <Typography variant="body2" color="text.secondary">Loading status map...</Typography>
                                )}
                            </Box>
                        </Box>
                    </Box>
                </TabPanel>

                {/* ACCOUNT TAB */}
                <TabPanel value={tabIndex} index={6}>
                    <Box sx={{ p: 4, maxWidth: 600 }}>
                        <Typography variant="h6" gutterBottom>Admin Account</Typography>
                        <Box sx={{ mb: 4, p: 2, bgcolor: 'rgba(255,255,255,0.03)', borderRadius: 1 }}>
                            <Typography variant="body2" color="text.secondary">Username</Typography>
                            <Typography variant="body1">{user?.username}</Typography>
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
