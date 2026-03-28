import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography,
    Tabs, Tab, Table, TableHead, TableBody, TableRow, TableCell, Chip,
    IconButton, CircularProgress, Button, Link
} from '@mui/material';
import {
    Close as CloseIcon,
    Refresh as RefreshIcon,
    ArrowUpward as ArrowUpwardIcon,
    ArrowDownward as ArrowDownwardIcon,
    UnfoldMore as UnfoldMoreIcon,
    OpenInNew as OpenInNewIcon
} from '@mui/icons-material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';

export default function ApDevicesModal({ open, onClose, defaultTab = 'all', unifiUrl }) {
    const [tab, setTab] = useState(defaultTab);
    const [sortBy, setSortBy] = useState('name');
    const [sortDir, setSortDir] = useState('asc');

    useEffect(() => {
        if (open) {
            setTab(defaultTab);
        }
    }, [open, defaultTab]);

    const { data: rawData, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['unifiDevices'],
        queryFn: () => axios.get('/api/v1/unifi/devices').then(res => res.data),
        enabled: open
    });

    const devicesData = rawData?.data || [];
    // Access Points only based on type or model
    const apDevices = useMemo(() => {
        if (!Array.isArray(devicesData)) return [];
        return devicesData.filter(d => d.type === 'uap' || (d.model && d.model.includes('UAP')));
    }, [devicesData]);

    const filteredDevices = useMemo(() => {
        if (tab === 'offline') {
            return apDevices.filter(d => d.state !== 1); // 1 is typically connected for Unifi devices
        }
        return apDevices;
    }, [apDevices, tab]);

    const handleSort = (column) => {
        if (column === sortBy) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortDir('asc');
        }
    };

    const sortedDevices = useMemo(() => {
        if (!filteredDevices) return [];
        return [...filteredDevices].sort((a, b) => {
            let aVal = a[sortBy] ?? (sortBy === 'name' ? (a.hostname || a.mac) : null);
            let bVal = b[sortBy] ?? (sortBy === 'name' ? (b.hostname || b.mac) : null);

            // Handle specific logical mappings
            if (sortBy === 'status') {
                aVal = a.state === 1 ? 1 : 0;
                bVal = b.state === 1 ? 1 : 0;
            }

            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            }

            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredDevices, sortBy, sortDir]);

    const offlineCount = apDevices.filter(d => d.state !== 1).length;

    const formatUptime = (seconds) => {
        if (!seconds) return '—';
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor(seconds % (3600 * 24) / 3600);
        const m = Math.floor(seconds % 3600 / 60);
        if (d > 0) return `${d}d ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        return `${m}m`;
    };

    const handleOpenUnifi = () => {
        if (unifiUrl && unifiUrl !== '#') {
            window.open(unifiUrl, '_blank', 'noopener,noreferrer');
        }
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{ sx: { bgcolor: '#111827', minHeight: '70vh' } }}
        >
            <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Box>
                    <Typography variant="h6">UniFi Access Points</Typography>
                    <Typography variant="caption" color="text.secondary">
                        Infrastructure view from UniFi Controller
                    </Typography>
                </Box>
                <Box>
                    <IconButton onClick={() => refetch()} disabled={isFetching} sx={{ mr: 1 }}>
                        <RefreshIcon />
                    </IconButton>
                    <IconButton onClick={onClose}>
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>

            <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, display: 'flex', justifyContent: 'space-between' }}>
                <Tabs value={tab} onChange={(e, v) => setTab(v)}>
                    <Tab label="All APs" value="all" sx={{ '&.Mui-selected': { color: '#3b82f6' } }} />
                    <Tab label="Offline APs" value="offline" sx={{ '&.Mui-selected': { color: '#ef4444' } }} />
                </Tabs>
                {unifiUrl && unifiUrl !== '#' && (
                    <Button
                        size="small"
                        endIcon={<OpenInNewIcon />}
                        onClick={handleOpenUnifi}
                        sx={{ mt: 1, mb: 1, textTransform: 'none' }}
                    >
                        Open UniFi Controller
                    </Button>
                )}
            </Box>

            <DialogContent sx={{ p: 0, maxHeight: '55vh' }}>
                {isLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <Table stickyHeader size="small">
                        <TableHead>
                            <TableRow>
                                <SortableHeader column="status" label="Status" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="name" label="Name" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="ip" label="IP Address" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="mac" label="MAC Address" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="model" label="Model" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="version" label="Version" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="num_sta" label="Clients" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                <SortableHeader column="uptime" label="Uptime" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {sortedDevices.map((d) => (
                                <TableRow key={d.mac} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                                    <TableCell>
                                        {d.state === 1 ? (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 6px #22c55e' }} />
                                                <Typography variant="body2" color="success.main">Online</Typography>
                                            </Box>
                                        ) : (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'error.main', boxShadow: '0 0 6px #ef4444', animation: 'pulse-red 2s infinite' }} />
                                                <Typography variant="body2" color="error.main">Offline</Typography>
                                            </Box>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        {d.name || d.hostname || <Typography variant="body2" fontStyle="italic" color="text.secondary">Unknown</Typography>}
                                    </TableCell>
                                    <TableCell>{d.ip || '—'}</TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace' }}>{d.mac || '—'}</TableCell>
                                    <TableCell>{d.model || '—'}</TableCell>
                                    <TableCell>{d.version || '—'}</TableCell>
                                    <TableCell align="right">{d.num_sta || 0}</TableCell>
                                    <TableCell align="right">{formatUptime(d.uptime)}</TableCell>
                                </TableRow>
                            ))}
                            {filteredDevices.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                                        No Access Points found for this filter.
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                )}
            </DialogContent>
            <DialogActions sx={{ justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                    Total APs: {apDevices.length} · <span style={{ color: offlineCount > 0 ? '#ef4444' : 'inherit' }}>{offlineCount} offline</span>
                </Typography>
            </DialogActions>
        </Dialog>
    );
}

function SortableHeader({ column, label, sortBy, sortDir, onSort, align = 'left' }) {
    const active = sortBy === column;
    return (
        <TableCell
            align={align}
            onClick={() => onSort(column)}
            sx={{
                cursor: 'pointer',
                userSelect: 'none',
                whiteSpace: 'nowrap',
                color: active ? 'primary.main' : 'text.secondary',
                '&:hover': { color: 'text.primary' },
                transition: 'color 0.15s'
            }}
        >
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
            }}>
                {label}
                {active ? (
                    sortDir === 'asc'
                        ? <ArrowUpwardIcon sx={{ fontSize: 14 }} />
                        : <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                ) : (
                    <UnfoldMoreIcon sx={{ fontSize: 14, opacity: 0.3 }} />
                )}
            </Box>
        </TableCell>
    );
}
