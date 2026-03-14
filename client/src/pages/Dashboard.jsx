import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography, Grid, Card, Chip, LinearProgress, Link, Tooltip, IconButton } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import StatCard from '../components/StatCard';
import LiveDevicesModal from '../components/LiveDevicesModal';
import { useSocket } from '../hooks/useSocket';
import {
    Computer, Warning,
    Wifi as WifiIcon, SettingsEthernet as EthernetIcon, Devices as DevicesIcon,
    Public as PublicIcon, ShieldOutlined as ShieldIcon, ReportProblemOutlined as ReportProblemIcon,
    NotificationsOutlined as NotificationsIcon, WifiTetheringOutlined as APTetheringIcon,
    WifiOutlined as WifiUserIcon, CheckCircleOutlined as CheckCircleIcon,
    Refresh as RefreshIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

function WlanStatusChip({ status }) {
    const config = {
        ok: { label: 'Healthy', color: 'success' },
        warning: { label: 'Warning', color: 'warning' },
        unknown: { label: 'Unknown', color: 'default' },
        unavailable: { label: 'Unavailable', color: 'default' }
    };
    const { label, color } = config[status] ?? { label: 'Unknown', color: 'default' };
    return (
        <Chip
            label={label}
            size="small"
            color={color}
            sx={{
                height: 18, fontSize: '0.65rem',
                bgcolor: color === 'success' ? 'rgba(34, 197, 94, 0.1)' : color === 'warning' ? 'rgba(245, 158, 11, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                color: color === 'success' ? '#22c55e' : color === 'warning' ? '#f59e0b' : '#9ca3af',
                border: 'none',
                fontWeight: 'bold'
            }}
        />
    );
}

export default function Dashboard() {
    const [liveModalOpen, setLiveModalOpen] = React.useState(false);
    const [liveModalTab, setLiveModalTab] = React.useState('all');
    const queryClient = useQueryClient();
    const socket = useSocket();

    const handleOpenLiveModal = (tab) => {
        setLiveModalTab(tab);
        setLiveModalOpen(true);
    };

    React.useEffect(() => {
        if (!socket) return;

        const handleApAlert = (alert) => {
            if (alert.type === 'ap_disconnected' || alert.type === 'ap_reconnected') {
                queryClient.invalidateQueries(['wlanHealth']);
            }
        };

        socket.on('alert:new', handleApAlert);
        return () => socket.off('alert:new', handleApAlert);
    }, [socket, queryClient]);

    const { data: devicesData } = useQuery({
        queryKey: ['devices'],
        queryFn: () => axios.get('/api/v1/devices').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: onlineData } = useQuery({
        queryKey: ['devices', 'online'],
        queryFn: () => axios.get('/api/v1/devices/online').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: counts } = useQuery({
        queryKey: ['devices', 'online', 'count'],
        queryFn: () => axios.get('/api/v1/devices/online/count').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: segmentsData } = useQuery({
        queryKey: ['segments'],
        queryFn: () => axios.get('/api/v1/segments').then(res => res.data),
        refetchInterval: 30000
    });

    const { data: alertsData } = useQuery({
        queryKey: ['alerts', 'recent'],
        queryFn: () => axios.get('/api/v1/alerts?unread=false').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: unreadAlerts } = useQuery({
        queryKey: ['alerts', 'count'],
        queryFn: () => axios.get('/api/v1/alerts/count').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: wlanHealthData } = useQuery({
        queryKey: ['wlanHealth'],
        queryFn: () => axios.get('/api/v1/unifi/wlan').then(res => res.data),
        refetchInterval: 60000
    });

    const { data: unifiSettings } = useQuery({
        queryKey: ['settings', 'unifi'],
        queryFn: () => axios.get('/api/v1/settings').then(res => res.data),
        staleTime: Infinity
    });

    const devices = devicesData?.devices || [];
    const onlineDevices = onlineData?.devices || [];
    const segments = segmentsData?.segments || [];
    const recentAlerts = alertsData?.alerts?.slice(0, 10) || [];
    const totalTracked = devices.length;
    const offlineTracked = devices.filter(d => d.status === 'down').length;

    const totalOnline = counts?.total || 0;
    const wiredCount = counts?.wired || 0;
    const wirelessCount = counts?.wireless || 0;

    const criticalDevices = devices.filter(d => d.is_critical === 1);
    const criticalTotal = criticalDevices.length;
    const criticalOnlineIPs = new Set(onlineDevices.filter(d => d.is_critical).map(d => d.ip));

    // Offline critical devices
    const offlineCriticalList = criticalDevices.filter(d => !criticalOnlineIPs.has(d.ip_address) && d.status === 'down');
    const criticalOffline = offlineCriticalList.length;

    // Alert breakdown
    const unreadCount = unreadAlerts?.unread_count || 0;
    const criticalAlerts = unreadAlerts?.critical_count || 0;
    const warningAlerts = unreadAlerts?.warning_count || 0;

    // WLAN Stats - Safe destructure with defaults
    const wlan = {
        status: wlanHealthData?.status ?? 'unavailable',
        num_user: wlanHealthData?.num_user ?? 0,
        num_ap: wlanHealthData?.num_ap ?? 0,
        num_adopted: wlanHealthData?.num_adopted ?? 0,
        num_disconnected: wlanHealthData?.num_disconnected ?? 0,
        num_pending: wlanHealthData?.num_pending ?? 0,
        tx_mbps: wlanHealthData?.tx_mbps ?? '0.00',
        rx_mbps: wlanHealthData?.rx_mbps ?? '0.00'
    };

    const num_disconnected = wlan.num_disconnected;
    const num_ap = wlan.num_ap;
    const num_adopted = wlan.num_adopted;
    const num_pending = wlan.num_pending;
    const num_user = wlan.num_user;

    const unifi_url = unifiSettings?.unifi_url
        || unifiSettings?.data?.unifi_url
        || '#';

    const handleApCardClick = () => {
        if (unifi_url && unifi_url !== '#') {
            window.open(unifi_url, '_blank', 'noopener,noreferrer');
        }
    };

    const pieData = [
        { name: 'Wired', value: wiredCount, color: '#22c55e' },
        { name: 'WiFi', value: wirelessCount, color: '#06b6d4' },
        { name: 'Offline (tracked)', value: offlineTracked, color: '#ef4444' }
    ];

    const getSeverityColor = (severity) => {
        switch (severity) {
            case 'critical': return 'error';
            case 'warning': return 'warning';
            default: return 'info';
        }
    };

    const scrollbarStyles = {
        '&::-webkit-scrollbar': { width: '4px' },
        '&::-webkit-scrollbar-track': { background: 'transparent' },
        '&::-webkit-scrollbar-thumb': {
            background: 'rgba(255,255,255,0.15)',
            borderRadius: '4px'
        },
        '&::-webkit-scrollbar-thumb:hover': { background: 'rgba(255,255,255,0.3)' }
    };

    return (
        <Box>
            <Typography variant="h4" gutterBottom fontWeight="bold">Dashboard</Typography>

            {/* ── ROW 1: Connectivity Summary (4 cards) ── */}
            <Grid container spacing={3} sx={{ mb: 1 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Total Online"
                        value={totalOnline}
                        subtitle="across all segments"
                        color="#3b82f6"
                        icon={<DevicesIcon />}
                        onClick={() => handleOpenLiveModal('all')}
                        hoverColor="rgba(59, 130, 246, 0.5)"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Wired (LAN)"
                        value={wiredCount}
                        subtitle="directly connected"
                        color="#22c55e"
                        icon={<EthernetIcon />}
                        onClick={() => handleOpenLiveModal('wired')}
                        hoverColor="rgba(34, 197, 94, 0.5)"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="Wireless (WiFi)"
                        value={wirelessCount}
                        subtitle="connected over WiFi"
                        color="#06b6d4"
                        icon={<WifiIcon />}
                        onClick={() => handleOpenLiveModal('wireless')}
                        hoverColor="rgba(6, 182, 212, 0.5)"
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card sx={{
                        p: 2,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: `4px solid ${num_disconnected === 0 ? '#22c55e' : '#ef4444'}`,
                        position: 'relative'
                    }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <APTetheringIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                                <Typography variant="overline" sx={{ fontWeight: 'bold', color: 'text.secondary', lineHeight: 1 }}>
                                    Access Points
                                </Typography>
                            </Box>
                        </Box>

                        {/* TOP SECTION */}
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                            <Box>
                                <Typography variant="h4" fontWeight="bold">
                                    {num_adopted} / {num_ap}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">adopted / total</Typography>
                            </Box>
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                                <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
                                    <Typography variant="caption" sx={{ color: '#22c55e', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                        {num_adopted} online
                                    </Typography>
                                </Box>
                                <Box sx={{
                                    px: 1, py: 0.2, borderRadius: 1,
                                    bgcolor: num_disconnected > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                                    border: num_disconnected > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(156, 163, 175, 0.2)'
                                }}>
                                    <Typography variant="caption" sx={{ color: num_disconnected > 0 ? '#ef4444' : '#9ca3af', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                        {num_disconnected} offline
                                    </Typography>
                                </Box>
                                {num_pending > 0 && (
                                    <Box sx={{ px: 1, py: 0.2, borderRadius: 1, bgcolor: 'rgba(245, 158, 11, 0.1)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                        <Typography variant="caption" sx={{ color: '#f59e0b', fontSize: '0.7rem', fontWeight: 'bold' }}>
                                            {num_pending} pending
                                        </Typography>
                                    </Box>
                                )}
                            </Box>
                        </Box>

                        {/* MIDDLE SECTION 1 */}
                        <Box sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                    ↑ {wlan.tx_mbps} Mbps  ↓ {wlan.rx_mbps} Mbps
                                </Typography>
                                <WlanStatusChip status={wlan.status} />
                            </Box>
                        </Box>

                        {/* MIDDLE SECTION 2 */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 'auto' }}>
                            <WifiUserIcon sx={{ fontSize: 16, color: '#06b6d4' }} />
                            <Typography variant="body2" sx={{ color: '#06b6d4', fontWeight: '500' }}>
                                {num_user}
                            </Typography>
                        </Box>

                        {/* BOTTOM SECTION */}
                        <Box
                            sx={{
                                mt: 2, pt: 1, borderTop: '1px solid rgba(255,255,255,0.06)',
                                display: 'flex', alignItems: 'center', gap: 1,
                                cursor: num_disconnected > 0 ? 'pointer' : 'default',
                                '&:hover': num_disconnected > 0 ? { bgcolor: 'rgba(255,255,255,0.02)' } : {}
                            }}
                            onClick={handleApCardClick}
                        >
                            {num_disconnected === 0 ? (
                                <>
                                    <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                                    <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 'bold' }}>
                                        All {num_ap} APs operational
                                    </Typography>
                                </>
                            ) : (
                                <>
                                    <Box sx={{
                                        width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef4444',
                                        boxShadow: '0 0 6px #ef4444', animation: 'pulse-red 2s infinite'
                                    }} />
                                    <Typography variant="caption" sx={{ color: '#ef4444', fontWeight: 'bold' }}>
                                        {num_disconnected} of {num_ap} AP(s) offline — check UniFi
                                    </Typography>
                                </>
                            )}
                        </Box>
                        <style>{`
                            @keyframes pulse-red {
                                0% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
                                70% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
                                100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                            }
                        `}</style>
                    </Card>
                </Grid>
            </Grid>

            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, pl: 1 }}>
                Total Online ({totalOnline}) = Wired <strong>{wiredCount}</strong> + WiFi <strong>{wirelessCount}</strong>
                {' · '} <strong>{num_user}</strong> on WiFi · <strong>{num_ap}</strong> APs
                {(wlan?.num_disconnected ?? 0) > 0 && (
                    <span style={{ color: '#ef4444' }}>
                        {' · '} ({wlan.num_disconnected} AP offline)
                    </span>
                )}
            </Typography>

            {/* ── ROW 2: Health & Alerts (3 cards) ── */}
            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6} md={4}>
                    <StatCard
                        title="Critical Devices"
                        value={criticalTotal}
                        subtitle={
                            criticalTotal === 0 ? <span style={{ color: '#9ca3af' }}>None configured</span> :
                                (criticalOffline === 0 ?
                                    <span style={{ color: '#22c55e' }}>All online</span> :
                                    <span style={{ color: '#ef4444' }}>{criticalOffline} of {criticalTotal} offline</span>
                                )
                        }
                        color="#f59e0b"
                        icon={<ShieldIcon />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                    <StatCard
                        title="Critical Devices Offline"
                        value={criticalTotal === 0 ? "-" : criticalOffline}
                        subtitle={
                            criticalTotal === 0 ? <span style={{ color: '#9ca3af' }}>No critical devices set</span> :
                                (criticalOffline === 0 ?
                                    <span style={{ color: '#22c55e' }}>All critical devices online</span> :
                                    <span style={{ color: '#ef4444' }}>
                                        {offlineCriticalList.slice(0, 2).map(d => d.hostname || d.ip_address).join(', ') +
                                            (criticalOffline > 2 ? ` + ${criticalOffline - 2} more` : '')}
                                    </span>
                                )
                        }
                        color="#ef4444"
                        urgent={criticalOffline > 0}
                        icon={<ReportProblemIcon />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={4}>
                    <StatCard
                        title="Active Alerts"
                        value={unreadCount}
                        subtitle={
                            unreadCount === 0 ?
                                <span style={{ color: '#22c55e' }}>No active alerts</span> :
                                `${criticalAlerts} critical · ${warningAlerts} warnings`
                        }
                        color={criticalAlerts > 0 ? "#ef4444" : (warningAlerts > 0 ? "#f59e0b" : "#22c55e")}
                        icon={<NotificationsIcon />}
                    />
                </Grid>
            </Grid>

            <Grid container spacing={3} alignItems="stretch">
                {/* Left Column */}
                <Grid item xs={12} md={8}>
                    <Grid container spacing={3}>
                        <Grid item xs={12} md={6}>
                            <Card sx={{ p: 3, height: 350 }}>
                                <Typography variant="h6" gutterBottom>Device Status Overview</Typography>
                                <ResponsiveContainer width="100%" height="90%">
                                    <PieChart>
                                        <Pie
                                            data={pieData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {pieData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <RechartsTooltip
                                            contentStyle={{ backgroundColor: '#111827', borderColor: '#3b82f6' }}
                                            itemStyle={{ color: '#fff' }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </Card>
                        </Grid>

                        <Grid item xs={12} md={6}>
                            <Card sx={{ p: 3, height: 350, overflowY: 'auto' }}>
                                <Typography variant="h6" gutterBottom>Network Segments Health</Typography>
                                {segments.length === 0 && <Typography color="text.secondary">No segments configured.</Typography>}
                                {segments.map(seg => {
                                    const totalDenom = seg.scan_total > 0 ? seg.scan_total : seg.registered_count;
                                    const percent = totalDenom > 0 ? (seg.online_count / totalDenom) * 100 : 0;

                                    let subText;
                                    if (seg.scan_total > 0 && seg.last_scan_at) {
                                        // "last scan: an hour ago" style logic, simplied to local string
                                        subText = `last scan: ${new Date(seg.last_scan_at).toLocaleString()}`;
                                    } else {
                                        subText = <React.Fragment>Run a <Link component={RouterLink} to="/segments" sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>scan</Link> for full visibility</React.Fragment>;
                                    }

                                    return (
                                        <Box key={seg.id} sx={{ mb: 3 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: seg.color || '#888' }} />
                                                    {seg.name} <Typography component="span" variant="caption" color="text.secondary">({seg.online_count} online)</Typography>
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {totalDenom === 0 ? "No scan data" : (
                                                        seg.scan_total > 0
                                                            ? `${seg.online_count} / ${seg.scan_total} UP`
                                                            : `${seg.online_count} / ${seg.registered_count} registered UP`
                                                    )}
                                                </Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={percent}
                                                color={percent === 100 ? "success" : percent > 50 ? "warning" : "error"}
                                                sx={{ height: 8, borderRadius: 4, mb: 0.5, opacity: totalDenom === 0 ? 0.2 : 1 }}
                                            />
                                            <Typography variant="caption" color="text.secondary">
                                                {subText}
                                            </Typography>
                                        </Box>
                                    );
                                })}
                            </Card>
                        </Grid>
                    </Grid>

                    <Card sx={{
                        mt: 3,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <Box sx={{ p: 3, pb: 0, flexShrink: 0 }}>
                            <Typography variant="h6">Recent Alerts</Typography>
                        </Box>

                        <Box sx={{
                            flex: 1,
                            maxHeight: 320,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            px: 3,
                            ...scrollbarStyles
                        }}>
                            <Box sx={{ minWidth: 400 }}>
                                {recentAlerts.length === 0 && (
                                    <Typography color="text.secondary" sx={{ py: 2 }}>
                                        No recent alerts.
                                    </Typography>
                                )}
                                {recentAlerts.map(alert => (
                                    <Box key={alert.id} sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        py: 1.5,
                                        borderBottom: '1px solid rgba(255,255,255,0.05)'
                                    }}>
                                        <Chip
                                            label={alert.severity}
                                            color={getSeverityColor(alert.severity)}
                                            size="small"
                                            sx={{ width: 80, mr: 2, textTransform: 'capitalize' }}
                                        />
                                        <Typography variant="body2" sx={{ flexGrow: 1 }}>
                                            {alert.message}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {new Date(alert.created_at).toLocaleString()}
                                        </Typography>
                                    </Box>
                                ))}
                            </Box>
                        </Box>

                        <Box sx={{
                            p: '8px 16px',
                            flexShrink: 0,
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            bgcolor: 'rgba(255,255,255,0.01)'
                        }}>
                            <Link
                                component={RouterLink}
                                to="/alerts"
                                variant="caption"
                                color="text.secondary"
                                sx={{ textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
                            >
                                View all {alertsData?.alerts?.length || 0} alerts →
                            </Link>
                        </Box>
                    </Card>
                </Grid>

                {/* Right Column — Critical Devices */}
                <Grid item xs={12} md={4}>
                    <Card sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column'
                    }}>
                        <Box sx={{ p: 3, pb: 2, flexShrink: 0 }}>
                            <Typography variant="h6" gutterBottom color="error.main">Critical Devices</Typography>
                            <Typography variant="body2" color="text.secondary">
                                Live status of devices marked as critical.
                            </Typography>
                        </Box>

                        <Box sx={{
                            flex: 1,
                            maxHeight: 320,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            px: 3,
                            ...scrollbarStyles
                        }}>
                            {criticalDevices.length === 0 &&
                                <Typography color="text.secondary" sx={{ py: 2 }}>
                                    No critical devices configured.
                                </Typography>
                            }
                            {criticalDevices.map(device => {
                                const mergedEntry = onlineDevices.find(d => d.ip === device.ip_address);
                                const isOnline = !!mergedEntry || device.status === 'up';
                                const latency = mergedEntry?.latency_ms ?? device.latency_ms;
                                const source = mergedEntry?.source;

                                return (
                                    <Box key={device.id} sx={{
                                        p: 2, mb: 2, borderRadius: 1,
                                        bgcolor: !isOnline ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                                        borderLeft: `3px solid ${isOnline ? '#22c55e' : '#ef4444'}`
                                    }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                            <Typography variant="subtitle2" fontWeight="bold">
                                                {device.hostname || device.ip_address}
                                            </Typography>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                {source && (
                                                    <Chip label={source} size="small" variant="outlined"
                                                        sx={{ height: 18, fontSize: '0.65rem', opacity: 0.7 }} />
                                                )}
                                                {isOnline ? (
                                                    <Box sx={{
                                                        width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main',
                                                        boxShadow: '0 0 8px #22c55e',
                                                        animation: 'pulse 2s infinite'
                                                    }} />
                                                ) : (
                                                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
                                                )}
                                            </Box>
                                        </Box>
                                        <Typography variant="caption" display="block" color="text.secondary">
                                            IP: {device.ip_address}
                                        </Typography>
                                        <Typography variant="caption" display="block" color="text.secondary">
                                            Latency: {latency != null ? `${latency} ms` : 'N/A'}
                                        </Typography>
                                    </Box>
                                );
                            })}
                        </Box>

                        <Box sx={{
                            p: '8px 16px',
                            flexShrink: 0,
                            borderTop: '1px solid rgba(255,255,255,0.1)',
                            bgcolor: 'rgba(255,255,255,0.01)'
                        }}>
                            {criticalTotal === 0 ? (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        No critical devices configured
                                    </Typography>
                                    <Link
                                        component={RouterLink}
                                        to="/settings?tab=critical"
                                        variant="caption"
                                        sx={{ textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
                                    >
                                        Configure in Settings →
                                    </Link>
                                </Box>
                            ) : (
                                <Typography variant="caption" color="text.secondary">
                                    {criticalTotal} critical device(s) monitored
                                </Typography>
                            )}
                        </Box>
                        <style>{`
              @keyframes pulse {
                0% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
                70% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
                100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
              }
            `}</style>
                    </Card>
                </Grid>
            </Grid>

            <LiveDevicesModal
                open={liveModalOpen}
                onClose={() => setLiveModalOpen(false)}
                defaultTab={liveModalTab}
            />
        </Box>
    );
}
