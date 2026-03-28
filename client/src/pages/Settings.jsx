import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
    Box, Typography, Button, TextField, Grid, Card, Checkbox, Switch,
    FormControlLabel, Tabs, Tab, Alert, Snackbar, InputAdornment, IconButton,
    MenuItem, Chip, CircularProgress
} from '@mui/material';
import {
    Visibility, VisibilityOff, Save as SaveIcon, PlayArrow as TestIcon,
    CheckCircle as ConnectedIcon, Error as ErrorIcon, HelpOutline as UnknownIcon,
    AutoAwesome as AiIcon, Refresh as RefreshIcon, Storage as StorageIcon
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
        ping_interval_ms: '60000', unifi_interval_ms: '300000', alert_cooldown_ms: '900000',
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
            alert_on_offline: s.alert_on_offline !== '0',
            alert_on_critical_offline: s.alert_on_critical_offline !== '0',
            alert_on_online: s.alert_on_online !== '0',
            alert_on_high_latency: s.alert_on_high_latency === '1',
        });

        setPolling({
            ping_interval_ms: s.ping_interval_ms || '60000',
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
        queryKey: ['aiModels', ai.ai_provider, ai.ai_anthropic_key, ai.ai_openrouter_key],
        queryFn: () => {
            const key = ai.ai_provider === 'anthropic' ? ai.ai_anthropic_key : ai.ai_openrouter_key;
            // Only fetch if we have a key (or it's 'sk-***' which means use the stored one)
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

    const fetchAiStatus = useQuery({
        queryKey: ['aiStatus'],
        queryFn: () => axios.get('/api/v1/ai/status').then(res => res.data),
        onSuccess: (data) => {
            if (data.status === 'ok') setAiStatus('connected');
            else if (data.status === 'error') setAiStatus('error');
        },
        retry: false,
        refetchOnWindowFocus: false
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

                {/* AI TAB */}
                <TabPanel value={tabIndex} index={2}>
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
                <TabPanel value={tabIndex} index={3}>
                    <Box sx={{ p: 4, maxWidth: 700 }}>
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

                        <Box sx={{ mt: 4 }}>
                            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => savePolling.mutate(polling)} disabled={savePolling.isPending}>
                                {savePolling.isPending ? 'Saving…' : 'Save and Restart Jobs'}
                            </Button>
                        </Box>
                    </Box>
                </TabPanel>

                {/* ACCOUNT TAB */}
                <TabPanel value={tabIndex} index={4}>
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
