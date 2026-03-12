import React from 'react';
import { Box, Typography, Grid, Card, Chip, LinearProgress } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import StatCard from '../components/StatCard';
import {
    Computer, CheckCircle, Cancel, Warning, Error as ErrorIcon
} from '@mui/icons-material';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';

export default function Dashboard() {
    const { data: devicesData } = useQuery({
        queryKey: ['devices'],
        queryFn: () => axios.get('/api/v1/devices').then(res => res.data),
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

    const devices = devicesData?.devices || [];
    const segments = segmentsData?.segments || [];
    const recentAlerts = alertsData?.alerts?.slice(0, 10) || [];
    const unreadCount = unreadAlerts?.unread_count || 0;

    const totalDevices = devices.length;
    const onlineDevices = devices.filter(d => d.status === 'up').length;
    const offlineDevices = devices.filter(d => d.status === 'down').length;
    const criticalOffline = devices.filter(d => d.is_critical === 1 && d.status === 'down').length;

    const pieData = [
        { name: 'Online', value: onlineDevices, color: '#22c55e' },
        { name: 'Offline', value: offlineDevices, color: '#ef4444' }
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

            <Grid container spacing={3} sx={{ mb: 4 }}>
                <Grid item xs={12} sm={6} md={2.4}>
                    <StatCard
                        title="Total Devices"
                        value={totalDevices}
                        color="#3b82f6"
                        icon={<Computer />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <StatCard
                        title="Online Now"
                        value={onlineDevices}
                        color="#22c55e"
                        icon={<CheckCircle />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <StatCard
                        title="Offline"
                        value={offlineDevices}
                        color="#ef4444"
                        icon={<Cancel />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <StatCard
                        title="Critical Offline"
                        value={criticalOffline}
                        color="#ef4444"
                        urgent={criticalOffline > 0}
                        icon={<Warning />}
                    />
                </Grid>
                <Grid item xs={12} sm={6} md={2.4}>
                    <StatCard
                        title="Active Alerts"
                        value={unreadCount}
                        color="#f59e0b"
                        icon={<ErrorIcon />}
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
                                    const percent = seg.device_count > 0 ? (seg.devices_up / seg.device_count) * 100 : 0;
                                    return (
                                        <Box key={seg.id} sx={{ mb: 2 }}>
                                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                                                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: seg.color || '#888' }} />
                                                    {seg.name}
                                                </Typography>
                                                <Typography variant="body2" color="text.secondary">
                                                    {seg.devices_up} / {seg.device_count} UP
                                                </Typography>
                                            </Box>
                                            <LinearProgress
                                                variant="determinate"
                                                value={percent}
                                                color={percent === 100 ? "success" : percent > 50 ? "warning" : "error"}
                                                sx={{ height: 8, borderRadius: 4 }}
                                            />
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

                {/* Right Column */}
                <Grid item xs={12} md={4}>
                    <Card sx={{ p: 3, height: '100%', minHeight: 400 }}>
                        <Typography variant="h6" gutterBottom color="error.main">Critical Devices</Typography>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            Live status of devices marked as critical.
                        </Typography>

                        <Box sx={{ mt: 2 }}>
                            {devices.filter(d => d.is_critical === 1).length === 0 &&
                                <Typography color="text.secondary">No critical devices configured.</Typography>
                            }
                            {devices.filter(d => d.is_critical === 1).map(device => (
                                <Box key={device.id} sx={{
                                    p: 2,
                                    mb: 2,
                                    borderRadius: 1,
                                    bgcolor: device.status === 'down' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(255,255,255,0.03)',
                                    borderLeft: `3px solid ${device.status === 'up' ? '#22c55e' : device.status === 'down' ? '#ef4444' : '#888'}`
                                }}>
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                        <Typography variant="subtitle2" fontWeight="bold">
                                            {device.hostname || device.ip_address}
                                        </Typography>
                                        {device.status === 'up' && (
                                            <Box sx={{
                                                width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main',
                                                boxShadow: '0 0 8px #22c55e',
                                                animation: 'pulse 2s infinite'
                                            }} />
                                        )}
                                        {device.status === 'down' && (
                                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main' }} />
                                        )}
                                    </Box>
                                    <Typography variant="caption" display="block" color="text.secondary">
                                        IP: {device.ip_address}
                                    </Typography>
                                    <Typography variant="caption" display="block" color="text.secondary">
                                        Latency: {device.latency_ms !== null ? `${device.latency_ms} ms` : 'N/A'}
                                    </Typography>
                                </Box>
                            ))}
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
        </Box >
    );
}
