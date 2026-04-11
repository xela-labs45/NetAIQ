import React, { useState, useEffect } from 'react';
import {
    Box, Typography, Grid, Card, CardContent, Button, Divider,
    Chip, Table, TableBody, TableCell, TableHead, TableRow,
    List, ListItem, ListItemIcon, ListItemText,
    CircularProgress, IconButton, Tooltip, Collapse,
    Snackbar, Alert, AlertTitle
} from '@mui/material';
import {
    AutoAwesome as AiIcon,
    Refresh as RefreshIcon,
    ExpandMore as ExpandMoreIcon,
    ExpandLess as ExpandLessIcon,
    DeviceUnknown as UnknownDeviceIcon,
    WarningAmber as WarningIcon,
    CheckCircleOutline as CheckIcon,
    ErrorOutline as ErrorIcon,
    AutoAwesomeOutlined
} from '@mui/icons-material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { io } from 'socket.io-client';
import { DEVICE_TYPES, getDeviceTypeIcon } from '../constants/deviceTypes';
import { format } from 'date-fns';
import { useNavigate } from 'react-router-dom';

export default function Insights() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [expandedAlert, setExpandedAlert] = useState(null);
    const [identifyState, setIdentifyState] = useState({}); // { [id]: 'idle'|'loading'|'success'|'error' }
    const [countdowns, setCountdowns] = useState({}); // { [id]: number }
    const [running, setRunning] = useState(false);
    const [lastCallFailed, setLastCallFailed] = useState(false);
    const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });

    const showToast = (message, severity = 'info') => {
        setToast({ open: true, message, severity });
    };

    // Socket.IO for real-time updates
    useEffect(() => {
        const socket = io();
        socket.on('ai:analysis_complete', ({ type }) => {
            if (type === 'anomaly') queryClient.invalidateQueries(['anomalies']);
            if (type === 'alert_triage') queryClient.invalidateQueries(['alerts']);
            setLastCallFailed(false);
            setRunning(false);
        });
        socket.on('ai:analysis_error', ({ message }) => {
            setLastCallFailed(true);
            setRunning(false);
            showToast(`Analysis failed: ${message}`, 'error');
        });
        return () => socket.disconnect();
    }, [queryClient]);

    // Countdown timer for rate limits
    useEffect(() => {
        const timer = setInterval(() => {
            setCountdowns(prev => {
                const next = { ...prev };
                let changed = false;
                Object.keys(next).forEach(id => {
                    if (next[id] > 0) {
                        next[id] -= 1;
                        changed = true;
                    } else {
                        delete next[id];
                        changed = true;
                    }
                });
                return changed ? next : prev;
            });
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    // Queries
    const { data: aiStatus } = useQuery({
        queryKey: ['aiStatus'],
        queryFn: () => axios.get('/api/v1/ai/status').then(res => res.data),
    });

    const anomaliesQuery = useQuery({
        queryKey: ['anomalies'],
        queryFn: () => axios.get('/api/v1/ai/anomalies').then(res => res.data),
    });

    const alertsQuery = useQuery({
        queryKey: ['alerts'],
        queryFn: () => axios.get('/api/v1/ai/alert-summary').then(res => res.data),
    });

    const unidentifiedQuery = useQuery({
        queryKey: ['unidentified'],
        queryFn: () => axios.get('/api/v1/ai/unidentified-devices').then(res => res.data),
    });

    // Data unwrapping (FIX 2D)
    const resultA = anomaliesQuery.data?.result;
    const resultT = alertsQuery.data?.result;

    const isFetchingAnalysis = anomaliesQuery.isFetching || alertsQuery.isFetching;
    const loadingAnalysis = anomaliesQuery.isLoading || alertsQuery.isLoading;

    const anomalies = resultA?.anomalies ?? [];

    const healthScore = resultA?.network_health_score;
    const healthSummary = resultA?.health_summary;
    const analysedDevices = resultA?.analysed_devices;

    const triageGroups = resultT?.triage_groups ?? [];
    const executiveSummary = resultT?.executive_summary;
    const isUrgent = resultT?.urgent_action_required;
    const noiseAlerts = resultT?.noise_alerts ?? [];

    const unidentifiedDevices = unidentifiedQuery.data || [];

    // Identification (FIX 4)
    const handleIdentify = async (deviceId) => {
        setIdentifyState(prev => ({ ...prev, [deviceId]: 'loading' }));
        try {
            const res = await axios.post('/api/v1/ai/identify-device', { device_id: deviceId });
            setIdentifyState(prev => ({ ...prev, [deviceId]: 'success' }));
            queryClient.invalidateQueries(['unidentified']);
            showToast('Device identified successfully', 'success');
        } catch (err) {
            if (err.response?.status === 429) {
                const resetIn = err.response.data.resetIn || 60;
                showToast(`Rate limit reached. Try again in ${resetIn}s.`, 'warning');
                setCountdowns(prev => ({ ...prev, [deviceId]: resetIn }));
                setIdentifyState(prev => ({ ...prev, [deviceId]: 'error' }));
            } else {
                setIdentifyState(prev => ({ ...prev, [deviceId]: 'error' }));
                showToast(err.response?.data?.error || 'Identification failed', 'error');
            }
        }
    };

    const handleRunAnalysis = async () => {
        setRunning(true);
        try {
            await Promise.all([
                axios.get('/api/v1/ai/anomalies', { params: { refresh: true } }),
                axios.get('/api/v1/ai/alert-summary', { params: { refresh: true } })
            ]);
            showToast('Analysis started · Results update automatically', 'info');
        } catch (err) {
            showToast('Failed to start analysis: ' + (err.response?.data?.error || err.message), 'error');
            setRunning(false);
        }
    };

    const handleDismissNoise = async () => {
        if (noiseAlerts.length === 0) return;
        try {
            await axios.post('/api/v1/ai/dismiss-noise', { alert_ids: noiseAlerts });
            showToast(`Dismissed ${noiseAlerts.length} noise alerts`, 'success');
            queryClient.invalidateQueries(['alerts']);
        } catch (err) {
            showToast('Failed to dismiss noise: ' + err.message, 'error');
        }
    };

    const handleRefresh = () => {
        anomaliesQuery.refetch();
        alertsQuery.refetch();
    };

    // UI Helpers (FIX 2A / 2C)
    const getConfidenceColor = (conf) => ({ high: 'success', medium: 'warning', low: 'default' }[conf] || 'default');
    const getConfidenceLabel = (conf) => ({ high: 'High', medium: 'Medium', low: 'Low' }[conf] || 'Unknown');
    const priorityConfig = {
        1: { label: 'Act Now', color: 'error' },
        2: { label: 'Today', color: 'warning' },
        3: { label: 'Monitor', color: 'info' }
    };

    // AI Unavailable rendering (FIX 7)
    if (aiStatus && !aiStatus.available) {
        const messages = {
            not_configured: {
                title: "AI not configured",
                body: "Choose a provider in Settings → AI Settings to get started.",
                actions: true
            },
            missing_key: {
                title: "API key missing",
                body: "Your AI provider is selected but no API key has been saved.",
                actions: true
            },
            disabled: {
                title: "AI features disabled",
                body: "AI is configured but currently disabled. Re-enable in Settings → AI Settings.",
                actions: false
            }
        };
        const msg = messages[aiStatus.unavailable_reason] || messages.not_configured;

        return (
            <Box sx={{ p: 4, maxWidth: 800, mx: 'auto', mt: 10 }}>
                <Alert severity="info" variant="outlined" action={
                    msg.actions && (
                        <Button color="inherit" size="small" onClick={() => navigate('/settings', { state: { tab: 4 } })}>
                            Configure →
                        </Button>

                    )
                }>
                    <AlertTitle>{msg.title}</AlertTitle>
                    {msg.body}
                </Alert>
            </Box>
        );
    }

    return (
        <Box sx={{ p: 4, maxWidth: 1600, mx: 'auto' }}>
            {/* Header */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
                <Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                        <AiIcon color="primary" sx={{ fontSize: 32 }} />
                        <Typography variant="h4" fontWeight="bold">AI Insights</Typography>
                        {(isFetchingAnalysis || running) && <CircularProgress size={20} />}
                    </Box>
                    <Typography variant="body2" color="text.secondary">
                        Network intelligence powered by {aiStatus?.provider === 'anthropic' ? 'Anthropic Claude' : 'OpenRouter'}.
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 2 }}>
                    <Button
                        variant="contained"
                        startIcon={<AiIcon />}
                        onClick={handleRunAnalysis}
                        disabled={running || loadingAnalysis}
                        sx={{ borderRadius: 2, px: 3 }}
                    >
                        {running ? 'Analysing...' : 'Run Full Analysis'}
                    </Button>
                    <IconButton onClick={handleRefresh} disabled={isFetchingAnalysis}>
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Box>

            {/* Error Banner (FIX 7) */}
            {lastCallFailed && (
                <Alert severity="warning" sx={{ mb: 4 }} action={
                    <Button color="inherit" size="small" onClick={handleRunAnalysis}>Retry</Button>
                }>
                    Last analysis failed — showing cached results. Check your API key or provider status.
                </Alert>
            )}

            <Grid container spacing={4}>
                {/* Left Column: Health & Identification */}
                <Grid item xs={12} lg={4}>
                    {/* Health Score (FIX 2B) */}
                    <Card sx={{ mb: 4, borderRadius: 3, background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.05) 0%, rgba(25, 118, 210, 0.02) 100%)' }}>
                        <CardContent sx={{ p: 3 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                                <Typography variant="h6">Network Health</Typography>
                                <Chip
                                    label={`${healthScore || 0}/100`}
                                    color={healthScore > 80 ? 'success' : healthScore > 50 ? 'warning' : 'error'}
                                    sx={{ fontWeight: 'bold' }}
                                />
                            </Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                                {healthSummary || "No health analysis available. Run analysis to generate one."}
                            </Typography>
                            {analysedDevices > 0 && (
                                <Typography variant="caption" color="text.disabled">
                                    Based on analysis of {analysedDevices} devices.
                                </Typography>
                            )}
                        </CardContent>
                    </Card>

                    {/* Pending Identifications (FIX 2A / 4) */}
                    <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                        <UnknownDeviceIcon fontSize="small" color="primary" /> Unknown Devices ({unidentifiedDevices.length})
                    </Typography>
                    <Card sx={{ mb: 4, borderRadius: 3 }}>
                        {unidentifiedDevices.length === 0 ? (
                            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                                All devices identified.
                            </Box>
                        ) : (
                            <List sx={{ p: 0 }}>
                                {unidentifiedDevices.map((device, idx) => (
                                    <React.Fragment key={device.id}>
                                        {idx > 0 && <Divider />}
                                        <ListItem sx={{ py: 2 }}>
                                            <ListItemText
                                                primary={device.hostname || device.mac_address}
                                                secondary={device.ip_address || 'No IP'}
                                            />
                                            <Button
                                                size="small"
                                                variant="outlined"
                                                disabled={identifyState[device.id] === 'loading' || !!countdowns[device.id]}
                                                color={
                                                    identifyState[device.id] === 'success' ? 'success' :
                                                        identifyState[device.id] === 'error' ? 'error' :
                                                            'primary'
                                                }
                                                onClick={() => handleIdentify(device.id)}
                                                startIcon={
                                                    identifyState[device.id] === 'loading'
                                                        ? <CircularProgress size={12} />
                                                        : identifyState[device.id] === 'success'
                                                            ? <CheckIcon />
                                                            : <AutoAwesomeOutlined />
                                                }
                                            >
                                                {identifyState[device.id] === 'loading' ? 'Thinking...' :
                                                    identifyState[device.id] === 'success' ? 'Identified' :
                                                        countdowns[device.id] ? `Wait ${countdowns[device.id]}s` :
                                                            identifyState[device.id] === 'error' ? 'Retry' :
                                                                'Identify'}
                                            </Button>
                                        </ListItem>
                                    </React.Fragment>
                                ))}
                            </List>
                        )}
                    </Card>

                    {/* Anomalies (FIX 2B) */}
                    <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1 }}>
                        <WarningIcon fontSize="small" color="warning" /> Traffic Anomalies
                    </Typography>
                    <Card sx={{ borderRadius: 3 }}>
                        {anomalies.length === 0 ? (
                            <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
                                No anomalies detected.
                            </Box>
                        ) : (
                            <List sx={{ p: 0 }}>
                                {anomalies.map((item, idx) => (
                                    <React.Fragment key={idx}>
                                        {idx > 0 && <Divider />}
                                        <ListItem alignItems="flex-start" sx={{ py: 2 }}>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                        <Typography variant="subtitle2" color="error.main">{item.title || item.type}</Typography>
                                                        <Chip label={item.severity} size="small" color={item.severity === 'critical' ? 'error' : 'warning'} />
                                                    </Box>
                                                }
                                                secondary={
                                                    <>
                                                        <Typography variant="body2" sx={{ mb: 1 }}>{item.description}</Typography>
                                                        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                                                            {item.affected_devices?.map(d => (
                                                                <Chip key={d.id} label={d.label} size="tiny" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                                                            ))}
                                                        </Box>
                                                    </>
                                                }
                                            />
                                        </ListItem>
                                    </React.Fragment>
                                ))}
                            </List>
                        )}
                    </Card>
                </Grid>

                {/* Right Column: Alert Triage */}
                <Grid item xs={12} lg={8}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1, px: 1 }}>
                        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <AiIcon fontSize="small" color="info" /> AI Alert Triage
                        </Typography>
                        {isUrgent && <Chip label="Action Required" color="error" size="small" variant="filled" />}
                    </Box>
                    <Card sx={{ borderRadius: 3, mb: 4 }}>
                        <CardContent sx={{ p: 3, bgcolor: 'rgba(0,0,0,0.02)' }}>
                            <Typography variant="subtitle2" gutterBottom color="primary">Executive Summary</Typography>
                            <Typography variant="body2">{executiveSummary || "Run analysis to triage your recent alerts."}</Typography>
                        </CardContent>
                        <Divider />
                        {triageGroups.length === 0 ? (
                            <Box sx={{ p: 6, textAlign: 'center', color: 'text.secondary' }}>
                                No triaged alert patterns found.
                            </Box>
                        ) : (
                            <Table sx={{ '& .MuiTableCell-root': { py: 2 } }}>
                                <TableHead>
                                    <TableRow sx={{ bgcolor: 'rgba(0,0,0,0.01)' }}>
                                        <TableCell width={40}></TableCell>
                                        <TableCell>Priority</TableCell>
                                        <TableCell>Observation / Pattern</TableCell>
                                        <TableCell align="center">Alerts</TableCell>
                                        <TableCell align="right">Action</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {triageGroups.map((group, idx) => {
                                        const config = priorityConfig[group.priority] || priorityConfig[3];
                                        return (
                                            <React.Fragment key={idx}>
                                                <TableRow hover sx={{ '&:last-child td, &:last-child th': { border: 0 } }}>
                                                    <TableCell sx={{ pr: 0 }}>
                                                        <IconButton size="small" onClick={() => setExpandedAlert(expandedAlert === idx ? null : idx)}>
                                                            {expandedAlert === idx ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                                                        </IconButton>
                                                    </TableCell>
                                                    <TableCell>
                                                        <Chip label={config.label} color={config.color} size="small" sx={{ width: 80 }} />
                                                    </TableCell>
                                                    <TableCell>
                                                        <Typography variant="subtitle2">{group.title}</Typography>
                                                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', maxWidth: 300 }}>
                                                            {group.pattern}
                                                        </Typography>
                                                    </TableCell>
                                                    <TableCell align="center">
                                                        <Chip label={group.alert_ids?.length || 0} size="small" variant="outlined" />
                                                    </TableCell>
                                                    <TableCell align="right">
                                                        <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                                            {group.recommended_action?.split(' ')[0]}...
                                                        </Typography>
                                                    </TableCell>
                                                </TableRow>
                                                <TableRow>
                                                    <TableCell colSpan={5} sx={{ p: 0 }}>
                                                        <Collapse in={expandedAlert === idx} timeout="auto" unmountOnExit>
                                                            <Box sx={{ m: 2, p: 2, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2, border: '1px solid rgba(255,255,255,0.05)' }}>
                                                                <Grid container spacing={2}>
                                                                    <Grid item xs={12} md={7}>
                                                                        <Typography variant="subtitle2" color="primary" gutterBottom>Pattern Details</Typography>
                                                                        <Typography variant="body2" sx={{ mb: 2 }}>{group.pattern}</Typography>
                                                                        <Typography variant="subtitle2" color="primary" gutterBottom>Estimated Impact</Typography>
                                                                        <Typography variant="body2">{group.estimated_impact}</Typography>
                                                                    </Grid>
                                                                    <Grid item xs={12} md={5}>
                                                                        <Typography variant="subtitle2" color="warning.main" gutterBottom>Recommended Action</Typography>
                                                                        <Box sx={{ p: 1.5, bgcolor: 'rgba(255,152,0,0.05)', borderRadius: 1, borderLeft: '4px solid', borderColor: 'warning.main' }}>
                                                                            <Typography variant="body2">{group.recommended_action}</Typography>
                                                                        </Box>
                                                                    </Grid>
                                                                </Grid>
                                                            </Box>
                                                        </Collapse>
                                                    </TableCell>
                                                </TableRow>
                                            </React.Fragment>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        )}
                    </Card>

                    {/* Noise Alerts */}
                    <Card sx={{ borderRadius: 3, bgcolor: 'rgba(0,0,0,0.01)', border: '1px dashed rgba(255,255,255,0.1)' }}>
                        <CardContent sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: '16px !important' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                <RefreshIcon sx={{ color: 'text.disabled' }} />
                                <Box>
                                    <Typography variant="subtitle2">AI detected {noiseAlerts.length} "noise" alerts</Typography>
                                    <Typography variant="caption" color="text.secondary">Alerts like port flapping or minor spikes that don't require action.</Typography>
                                </Box>
                            </Box>
                            <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                onClick={handleDismissNoise}
                                disabled={noiseAlerts.length === 0}
                            >
                                Dismiss All Noise
                            </Button>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* Notifications */}
            <Snackbar open={toast.open} autoHideDuration={6000} onClose={() => setToast({ ...toast, open: false })}>
                <Alert onClose={() => setToast({ ...toast, open: false })} severity={toast.severity} sx={{ width: '100%' }}>
                    {toast.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
