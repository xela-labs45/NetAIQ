import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Typography, Grid, Card, Chip, LinearProgress, Link, Tooltip, IconButton } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import StatCard from '../components/StatCard';
import LiveDevicesModal from '../components/LiveDevicesModal';
import ApDevicesModal from '../components/ApDevicesModal';
import { ErrorBoundary } from 'react-error-boundary';
import { PageErrorFallback } from '../App';
import AppLoader from '../components/AppLoader';
import { Skeleton } from '@mui/material';
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


export default function Dashboard() {
    const [liveModalOpen, setLiveModalOpen] = React.useState(false);
    const [liveModalTab, setLiveModalTab] = React.useState('all');
    const [apModalOpen, setApModalOpen] = React.useState(false);
    const [apModalFilter, setApModalFilter] = React.useState('all');
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

    const { data: devicesData, isLoading: devicesLoading } = useQuery({
        queryKey: ['devices'],
        queryFn: () => axios.get('/api/v1/devices').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: onlineData, isLoading: onlineLoading } = useQuery({
        queryKey: ['devices', 'online'],
        queryFn: () => axios.get('/api/v1/devices/online').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: counts, isLoading: countsLoading } = useQuery({
        queryKey: ['devices', 'online', 'count'],
        queryFn: () => axios.get('/api/v1/devices/online/count').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: discoveryStats, isLoading: discoveryStatsLoading } = useQuery({
        queryKey: ['discovery', 'stats'],
        queryFn: () => axios.get('/api/v1/discovery/discovered/stats').then(res => res.data),
        refetchInterval: 30000
    });

    const { data: segmentsData, isLoading: segmentsLoading } = useQuery({
        queryKey: ['segments'],
        queryFn: () => axios.get('/api/v1/segments').then(res => res.data),
        refetchInterval: 30000
    });

    const { data: alertsData, isLoading: alertsLoading } = useQuery({
        queryKey: ['alerts', 'recent'],
        queryFn: () => axios.get('/api/v1/alerts?unread=false').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: unreadAlerts, isLoading: unreadAlertsLoading } = useQuery({
        queryKey: ['alerts', 'count'],
        queryFn: () => axios.get('/api/v1/alerts/count').then(res => res.data),
        refetchInterval: 10000
    });

    const { data: wlanHealthData, isLoading: wlanLoading } = useQuery({
        queryKey: ['wlanHealth'],
        queryFn: () => axios.get('/api/v1/unifi/wlan').then(res => res.data),
        refetchInterval: 60000
    });

    const { data: unifiSettings, isLoading: settingsLoading } = useQuery({
        queryKey: ['settings', 'unifi'],
        queryFn: () => axios.get('/api/v1/settings').then(res => res.data),
        staleTime: Infinity
    });

    const globalLoading = devicesLoading || onlineLoading || countsLoading || discoveryStatsLoading || segmentsLoading || alertsLoading || wlanLoading;


    const devices = devicesData?.devices || [];
    const onlineDevices = onlineData?.devices || [];
    const segments = segmentsData?.segments || [];
    const recentAlerts = alertsData?.alerts?.slice(0, 10) || [];
    const totalTracked = devices.length;
    const offlineTracked = devices.filter(d => d.status === 'down').length;

    const totalOnline = counts?.total || 0;
    const wiredCount = counts?.wired || 0;
    const wirelessCount = counts?.wireless || 0;

    const discoveredWired = discoveryStats?.wired || 0;
    const discoveredWireless = discoveryStats?.wireless || 0;

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

    const unifi_url = unifiSettings?.settings?.unifi_url || '#';

    const handleApCardClick = (e, filter = 'all') => {
        if (e) e.stopPropagation();
        setApModalFilter(filter);
        setApModalOpen(true);
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
        <Box sx={{ 
            '& .MuiSkeleton-root': {
                backgroundColor: 'rgba(255,255,255,0.08)',
                '&::after': {
                    background: `linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)`
                }
            } 
        }}>
            <AppLoader appLoading={globalLoading && !devicesData} />
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
                        loading={globalLoading}
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
                        loading={globalLoading}
                        extraAction={
                            <Link
                                component="button"
                                variant="caption"
                                sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' }, textDecoration: 'none' }}
                                onClick={(e) => { e.stopPropagation(); handleOpenLiveModal('discovered_wired'); }}
                            >
                                View all {discoveredWired} ever seen →
                            </Link>
                        }
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
                        loading={globalLoading}
                        extraAction={
                            <Link
                                component="button"
                                variant="caption"
                                sx={{ color: 'text.secondary', '&:hover': { color: 'primary.main' }, textDecoration: 'none' }}
                                onClick={(e) => { e.stopPropagation(); handleOpenLiveModal('discovered_wireless'); }}
                            >
                                View all {discoveredWireless} ever seen →
                            </Link>
                        }
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={3}>
                    <Card sx={{
                        p: 2,
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        borderLeft: `4px solid ${num_disconnected === 0 ? '#22c55e' : '#ef4444'}`,
                        position: 'relative',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }
                    }}
                        onClick={(e) => handleApCardClick(e, 'all')}
                    >
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
                                    {globalLoading ? <Skeleton width={60} /> : num_ap}
                                </Typography>
                                {globalLoading ? (
                                    <Skeleton width={80} height={16} />
                                ) : (
                                    <Typography variant="caption" color="text.secondary">total APs</Typography>
                                )}
                            </Box>
                            {!globalLoading && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, alignItems: 'flex-end' }}>
                                <Box sx={{
                                    px: 1, py: 0.2, borderRadius: 1,
                                    bgcolor: num_disconnected > 0 ? 'rgba(239, 68, 68, 0.1)' : 'rgba(156, 163, 175, 0.1)',
                                    border: num_disconnected > 0 ? '1px solid rgba(239, 68, 68, 0.2)' : '1px solid rgba(156, 163, 175, 0.2)',
                                    cursor: num_disconnected > 0 ? 'pointer' : 'default',
                                    '&:hover': num_disconnected > 0 ? { bgcolor: 'rgba(239, 68, 68, 0.15)' } : {}
                                }}
                                    onClick={(e) => {
                                        if (num_disconnected > 0) handleApCardClick(e, 'offline');
                                    }}
                                >
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
                            )}
                        </Box>

                        {/* MIDDLE SECTION 1 */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                            <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                {globalLoading ? <Skeleton width={150} height={16} /> : `↓ ${wlan.tx_mbps} Mbps  ↑ ${wlan.rx_mbps} Mbps`}
                            </Typography>
                        </Box>


                        {/* BOTTOM SECTION */}
                        <Box
                            sx={{
                                mt: 2, pt: 1, borderTop: '1px solid rgba(255,255,255,0.06)',
                                display: 'flex', alignItems: 'center', gap: 1
                            }}
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


            {/* ── BOTTOM GRID SECTION (3 Rows) ── */}
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridTemplateRows: 'auto auto 1fr',
                gap: 2,
                alignItems: 'stretch'
            }}>
                {/* Row 1 left — Critical Devices count card */}
                <Box sx={{ gridColumn: '1', gridRow: '1' }}>
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
                        sx={{ height: '100%', minHeight: 'unset' }}
                        loading={globalLoading}
                    />
                </Box>

                {/* Row 1 middle — Critical Devices Offline card */}
                <Box sx={{ gridColumn: '2', gridRow: '1' }}>
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
                        sx={{ height: '100%', minHeight: 'unset' }}
                        loading={globalLoading}
                    />
                </Box>

                {/* Row 2 left — Device Status Overview */}
                <Box sx={{ gridColumn: '1', gridRow: '2' }}>
                    <Card sx={{ p: 2, height: '100%', minHeight: 300 }}>
                        <Typography variant="h6" gutterBottom>Device Status Overview</Typography>
                        <ResponsiveContainer width="100%" height="85%">
                            {globalLoading ? (
                                <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                                    <Skeleton variant="circular" width={160} height={160} />
                                </Box>
                            ) : (
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
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
                            )}
                        </ResponsiveContainer>
                    </Card>
                </Box>

                {/* Row 2 middle — Network Segments Health */}
                <Box sx={{ gridColumn: '2', gridRow: '2' }}>
                    <Card sx={{ p: 2, height: '100%', minHeight: 300, overflowY: 'auto', ...scrollbarStyles }}>
                        <Typography variant="h6" gutterBottom>Network Segments Health</Typography>
                        
                        {globalLoading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <Box key={i} sx={{ mb: 2 }}>
                                    <Skeleton width={120} height={16} sx={{ mb: 0.5 }} />
                                    <Skeleton variant="rectangular" height={8} sx={{ borderRadius: 1 }} />
                                </Box>
                            ))
                        ) : (
                            <>
                            {segments.length === 0 && <Typography color="text.secondary">No segments configured.</Typography>}
                            {segments.map(seg => {
                                const totalDenom = seg.scan_total > 0 ? seg.scan_total : seg.registered_count;
                                const percent = totalDenom > 0 ? (seg.online_count / totalDenom) * 100 : 0;

                                let subText;
                                if (seg.scan_total > 0 && seg.last_scan_at) {
                                    subText = `last scan: ${new Date(seg.last_scan_at).toLocaleString('en-GB', { hour12: false }).replace(/\//g, '-').replace(',', '')}`;
                                } else {
                                    subText = <React.Fragment>Run a <Link component={RouterLink} to="/segments" sx={{ color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}>scan</Link></React.Fragment>;
                                }

                                return (
                                    <Box key={seg.id} sx={{ mb: 2 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '0.8rem' }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: seg.color || '#888' }} />
                                                {seg.name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {totalDenom === 0 ? "No scan data" : `${seg.online_count} / ${totalDenom} UP`}
                                            </Typography>
                                        </Box>
                                        <LinearProgress
                                            variant="determinate"
                                            value={percent}
                                            color={percent === 100 ? "success" : percent > 50 ? "warning" : "error"}
                                            sx={{ height: 6, borderRadius: 3, mb: 0.5, opacity: totalDenom === 0 ? 0.2 : 1 }}
                                        />
                                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                                            {subText}
                                        </Typography>
                                    </Box>
                                );
                            })}
                            </>
                        )}
                    </Card>
                </Box>

                {/* Row 3 left — Recent Alerts, spans 2 columns */}
                <Box sx={{
                    gridColumn: '1 / 3',
                    gridRow: '3',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <Box sx={{ p: '12px 16px 8px', flexShrink: 0 }}>
                            <Typography variant="h6">Recent Alerts</Typography>
                        </Box>

                        <Box sx={{
                            flex: 1,
                            maxHeight: 220,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            px: '8px',
                            ...scrollbarStyles
                        }}>
                            {recentAlerts.length === 0 && (
                                <Typography color="text.secondary" sx={{ py: 2, px: 1 }}>
                                    No recent alerts.
                                </Typography>
                            )}
                            {recentAlerts.map(alert => (
                                <Box key={alert.id} sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    py: '5px',
                                    px: 1,
                                    minHeight: 'unset',
                                    borderBottom: '1px solid rgba(255,255,255,0.04)'
                                }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                                        <Chip
                                            label={alert.severity}
                                            color={getSeverityColor(alert.severity)}
                                            size="small"
                                            sx={{ height: 20, fontSize: '0.65rem', textTransform: 'capitalize', width: 70, flexShrink: 0 }}
                                        />
                                        <Typography variant="body2" sx={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {alert.message}
                                        </Typography>
                                    </Box>
                                    <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.disabled', ml: 1, flexShrink: 0 }}>
                                        {(() => {
                                            const tz = unifiSettings?.settings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
                                            // SQLite CURRENT_TIMESTAMP is UTC but has no 'Z'; force UTC parsing
                                            const raw = alert.created_at;
                                            const utcStr = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z';
                                            const d = new Date(utcStr);
                                            const now = new Date();
                                            const dateInTz = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
                                            const isToday = dateInTz(d) === dateInTz(now);
                                            const yesterday = new Date(now);
                                            yesterday.setDate(now.getDate() - 1);
                                            const isYesterday = dateInTz(d) === dateInTz(yesterday);
                                            const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz });
                                            if (isToday) return `Today ${time}`;
                                            if (isYesterday) return `Yesterday ${time}`;
                                            return d.toLocaleString('en-GB', { hour12: false, timeZone: tz }).replace(/\//g, '-').replace(',', '');
                                        })()}
                                    </Typography>
                                </Box>
                            ))}
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
                                sx={{ fontSize: '0.75rem', textDecoration: 'none', '&:hover': { color: 'primary.main' } }}
                            >
                                View all {alertsData?.alerts?.length || 0} alerts →
                            </Link>
                        </Box>
                    </Card>
                </Box>

                {/* Right column — Critical Devices panel, spans all 3 rows */}
                <Box sx={{
                    gridColumn: '3',
                    gridRow: '1 / 4',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    <Card sx={{
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0
                    }}>
                        <Box sx={{ p: '12px 16px 8px', flexShrink: 0 }}>
                            <Typography variant="h6" gutterBottom color="error.main" sx={{ mb: 0.5 }}>Critical Devices</Typography>
                            <Typography variant="caption" color="text.secondary">
                                Live status of devices marked as critical.
                            </Typography>
                        </Box>

                        <Box sx={{
                            flex: 1,
                            overflowY: 'auto',
                            overflowX: 'hidden',
                            minHeight: 0,
                            px: '8px',
                            ...scrollbarStyles
                        }}>
                            {globalLoading ? (
                                Array.from({ length: 4 }).map((_, i) => (
                                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                                        <Skeleton variant="circular" width={10} height={10} sx={{ mr: 1.5 }} />
                                        <Skeleton width={160} height={16} />
                                        <Skeleton width={60} height={16} sx={{ ml: 'auto' }} />
                                    </Box>
                                ))
                            ) : (
                                <>
                                {criticalDevices.length === 0 &&
                                    <Typography color="text.secondary" sx={{ py: 2, px: 1 }}>
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
                                            p: '8px 8px', borderRadius: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            bgcolor: !isOnline ? 'rgba(239, 68, 68, 0.05)' : 'transparent',
                                            borderBottom: '1px solid rgba(255,255,255,0.04)'
                                        }}>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Box sx={{
                                                        width: 6, height: 6, borderRadius: '50%',
                                                        bgcolor: isOnline ? 'success.main' : 'error.main',
                                                        boxShadow: isOnline ? '0 0 6px #22c55e' : 'none',
                                                        animation: isOnline ? 'pulse 2s infinite' : 'none',
                                                        flexShrink: 0
                                                    }} />
                                                    <Typography variant="subtitle2" sx={{ fontSize: '0.82rem', fontWeight: 'bold', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {device.hostname || device.ip_address}
                                                    </Typography>
                                                </Box>
                                                <Typography variant="caption" sx={{ fontSize: '0.7rem', color: 'text.secondary', ml: 2 }}>
                                                    {device.ip_address} · {latency != null ? `${latency}ms` : 'N/A'}
                                                </Typography>
                                            </Box>
                                            {source && (
                                                <Chip label={source} size="small" variant="outlined"
                                                    sx={{ height: 16, fontSize: '0.6rem', opacity: 0.6, flexShrink: 0 }} />
                                            )}
                                        </Box>
                                    );
                                })}
                                </>
                            )}
                        </Box>

                        <Box sx={{
                            p: '8px 16px',
                            flexShrink: 0,
                            borderTop: '1px solid rgba(255,255,255,0.06)',
                            bgcolor: 'rgba(255,255,255,0.01)'
                        }}>
                            <Typography variant="caption" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                {criticalTotal === 0 ? "No critical devices configured" : `${criticalTotal} critical device(s) monitored`}
                            </Typography>
                        </Box>
                        <style>{`
                            @keyframes pulse {
                                0% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
                                70% { opacity: 0.7; box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
                                100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
                            }
                        `}</style>
                    </Card>
                </Box>
            </Box>

            <ErrorBoundary FallbackComponent={PageErrorFallback}>
                <LiveDevicesModal
                    open={liveModalOpen}
                    onClose={() => setLiveModalOpen(false)}
                    defaultTab={liveModalTab}
                />
            </ErrorBoundary>

            <ErrorBoundary FallbackComponent={PageErrorFallback}>
                <ApDevicesModal
                    open={apModalOpen}
                    onClose={() => setApModalOpen(false)}
                    defaultTab={apModalFilter}
                    unifiUrl={unifi_url}
                />
            </ErrorBoundary>
        </Box>
    );
}
