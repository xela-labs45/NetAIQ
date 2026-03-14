import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography, Grid, Card, Chip, LinearProgress, Link } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import StatCard from '../components/StatCard';
import LiveDevicesModal from '../components/LiveDevicesModal';
import {
    Computer, Warning,
    Wifi as WifiIcon, SettingsEthernet as EthernetIcon, Devices as DevicesIcon,
    Public as PublicIcon, ShieldOutlined as ShieldIcon, ReportProblemOutlined as ReportProblemIcon,
    NotificationsOutlined as NotificationsIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
    const [liveModalOpen, setLiveModalOpen] = React.useState(false);
    const [liveModalTab, setLiveModalTab] = React.useState('all');

    const handleOpenLiveModal = (tab) => {
        setLiveModalTab(tab);
        setLiveModalOpen(true);
    };

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

    const { data: wanData } = useQuery({
        queryKey: ['unifi', 'wan'],
        queryFn: () => axios.get('/api/v1/unifi/wan').then(res => res.data),
        refetchInterval: 30000
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

    // WAN Stats
    const wanStats = wanData?.stats || { status: 'unknown', wan_ip: null, tx_mbps: '0', rx_mbps: '0' };
    const isWanOnline = wanStats.status === 'up';
    const isWanUnknown = wanStats.status === 'unknown';
    const wanIp = wanStats.wan_ip || 'IP unavailable';
    const txMbps = wanStats.tx_mbps;
    const rxMbps = wanStats.rx_mbps;

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
                    <StatCard
                        title="WAN Status"
                        value={
                            isWanOnline ? (
                                <Chip label="Online" color="success" size="small" />
                            ) : wanStats.status === 'down' ? (
                                <Chip label="Offline" color="error" size="small" />
                            ) : (
                                <Chip label="Unknown" color="default" size="small" />
                            )
                        }
                        subtitle={
                            isWanUnknown ? (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" display="block">
                                        UniFi connected but WAN data unreadable
                                    </Typography>
                                    <Link component="button" variant="caption" onClick={() => console.log('WAN Debug Data:', wanStats)} sx={{ mt: 0.5 }}>
                                        Check console logs
                                    </Link>
                                </Box>
                            ) : (
                                <Box>
                                    <Typography variant="caption" display="block">{wanIp}</Typography>
                                    {isWanOnline && (
                                        <>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                                                ↑ {txMbps} Mbps  ↓ {rxMbps} Mbps
                                            </Typography>
                                            {wanStats.latency && (
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    Latency: {wanStats.latency}ms
                                                </Typography>
                                            )}
                                        </>
                                    )}
                                </Box>
                            )
                        }
                        color={isWanUnknown ? "#9ca3af" : (isWanOnline ? "#22c55e" : "#ef4444")}
                        icon={<PublicIcon />}
                    />
                </Grid>
            </Grid>

            {/* Inline equation */}
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3, pl: 1 }}>
                Total Online ({totalOnline}) = Wired <strong>{wiredCount}</strong> + WiFi <strong>{wirelessCount}</strong>
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

            <Grid container spacing={3}>
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

                    <Card sx={{ mt: 3, p: 3, overflowX: 'auto' }}>
                        <Typography variant="h6" gutterBottom>Recent Alerts</Typography>
                        <Box sx={{ minWidth: 600 }}>
                            {recentAlerts.length === 0 && <Typography color="text.secondary">No recent alerts.</Typography>}
                            {recentAlerts.map(alert => (
                                <Box key={alert.id} sx={{ display: 'flex', alignItems: 'center', py: 1.5, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
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
                    </Card>
                </Grid>

                {/* Right Column — Critical Devices */}
                <Grid item xs={12} md={4}>
                    <Card sx={{ p: 3, height: '100%', minHeight: 400 }}>
                        <Typography variant="h6" gutterBottom color="error.main">Critical Devices</Typography>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Live status of devices marked as critical.
                        </Typography>

                        <Box sx={{ mt: 2 }}>
                            {criticalDevices.length === 0 &&
                                <Typography color="text.secondary">No critical devices configured.</Typography>
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
