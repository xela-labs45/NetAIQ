import React, { useState, useEffect, useMemo } from 'react';
import {
    Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography,
    Tabs, Tab, Table, TableHead, TableBody, TableRow, TableCell, Chip,
    IconButton, Tooltip, CircularProgress, Button, TextField, MenuItem,
    FormControlLabel, Switch
} from '@mui/material';
import {
    Close as CloseIcon,
    Refresh as RefreshIcon,
    SettingsEthernet as EthernetIcon,
    Wifi as WifiIcon,
    CheckCircleOutline as CheckCircleIcon,
    HelpOutline as UnknownIcon,
    ArrowUpward as ArrowUpwardIcon,
    ArrowDownward as ArrowDownwardIcon,
    UnfoldMore as UnfoldMoreIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSocket } from '../hooks/useSocket';

export default function LiveDevicesModal({ open, onClose, defaultTab = 'all' }) {
    const queryClient = useQueryClient();
    const socket = useSocket();
    const [tab, setTab] = useState(defaultTab);
    const [sortBy, setSortBy] = useState('is_registered');
    const [sortDir, setSortDir] = useState('asc');

    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [addFormData, setAddFormData] = useState({
        hostname: '', ip_address: '', mac_address: '',
        device_type: 'workstation', segment_id: '', is_critical: false, notes: 'Added from Live Devices'
    });

    const { data: segmentsData } = useQuery({
        queryKey: ['segments'],
        queryFn: () => axios.get('/api/v1/segments').then(res => res.data),
        enabled: open
    });

    // Track real-time events locally to avoid blowing up the render cache constantly
    const [liveUpdates, setLiveUpdates] = useState({});

    useEffect(() => {
        if (open) {
            setTab(defaultTab);
        }
    }, [open, defaultTab]);

    useEffect(() => {
        if (!socket || !open) return;

        const handleStatus = (data) => {
            // Map IP instead of device_id to correlate with Unregistered devices if possible
            // (Though the backend 'device:status' sends {device_id, status, ...}, 
            //  unregistered devices won't trigger this anyway because they aren't pinged via DB)
            setLiveUpdates(prev => ({ ...prev, [data.device_id]: data }));
        };

        socket.on('device:status', handleStatus);
        return () => {
            socket.off('device:status', handleStatus);
        };
    }, [socket, open]);

    useEffect(() => {
        setSortBy('is_registered');
        setSortDir('asc');
    }, [tab]);

    const { data, isLoading, refetch, isFetching } = useQuery({
        queryKey: ['liveDevices', tab],
        queryFn: () => axios.get(`/api/v1/devices/online?connection=${tab}`).then(res => res.data),
        enabled: open
    });

    const bulkMutation = useMutation({
        mutationFn: (payload) => axios.post('/api/v1/devices/bulk', payload),
        onSuccess: (res) => {
            queryClient.invalidateQueries(['devices']);
            queryClient.invalidateQueries(['liveDevices']);
            alert(`Success! Registered ${res.data.registered} devices. Skipped ${res.data.skipped}.`);
        }
    });

    const singleAddMutation = useMutation({
        mutationFn: (payload) => axios.post('/api/v1/devices', payload),
        onSuccess: () => {
            queryClient.invalidateQueries(['devices']);
            queryClient.invalidateQueries(['liveDevices']);
            setAddDialogOpen(false);
        }
    });

    const devices = data?.devices || [];

    const handleSort = (column) => {
        if (column === sortBy) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(column);
            setSortDir('asc');
        }
    };

    const sortedDevices = useMemo(() => {
        if (!devices) return [];
        return [...devices].sort((a, b) => {
            let aVal = a[sortBy];
            let bVal = b[sortBy];

            // Handle nulls — always sort to bottom regardless of direction
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Numeric columns
            if (typeof aVal === 'number' && typeof bVal === 'number') {
                return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            }

            // Boolean columns (is_registered, is_wired, is_critical)
            if (typeof aVal === 'boolean') {
                return sortDir === 'asc'
                    ? (aVal === bVal ? 0 : aVal ? 1 : -1)
                    : (aVal === bVal ? 0 : aVal ? -1 : 1);
            }

            // String columns — case insensitive
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [devices, sortBy, sortDir]);

    const unregisteredCount = devices.filter(d => !d.is_registered).length;

    const handleBulkRegister = () => {
        const unregistered = devices.filter(d => !d.is_registered);
        if (!unregistered.length) return;

        if (window.confirm(`Are you sure you want to register ${unregistered.length} devices?`)) {
            bulkMutation.mutate({ devices: unregistered });
        }
    };

    const handleOpenSingleAdd = (device) => {
        setAddFormData({
            hostname: device.hostname || '',
            ip_address: device.ip,
            mac_address: device.mac || '',
            device_type: 'workstation',
            segment_id: device.segment_id || '',
            is_critical: false,
            notes: 'Auto-registered from live scan popup'
        });
        setAddDialogOpen(true);
    };

    const formatBytes = (bytes) => {
        if (bytes == null) return "—";
        if (bytes === 0) return '0 B';
        const k = 1000;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    return (
        <>
            <Dialog
                open={open}
                onClose={onClose}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: { bgcolor: '#111827', minHeight: '70vh' } }}
            >
                <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Typography variant="h6">Live Network Devices</Typography>
                        <Typography variant="caption" color="text.secondary">
                            Live view from UniFi + segment scans · not all devices may be registered
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

                <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                    <Tabs value={tab} onChange={(e, v) => setTab(v)}>
                        <Tab label={`All`} value="all" sx={{ '&.Mui-selected': { color: '#3b82f6' } }} />
                        <Tab label={`Wired`} value="wired" sx={{ '&.Mui-selected': { color: '#22c55e' } }} />
                        <Tab label={`Wireless`} value="wireless" sx={{ '&.Mui-selected': { color: '#06b6d4' } }} />
                    </Tabs>
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
                                    <TableCell>Status</TableCell>
                                    <SortableHeader column="hostname" label="Hostname" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="ip" label="IP Address" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="mac" label="MAC" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="source" label="Source" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="is_wired" label="Connection" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    {tab !== 'wired' && <SortableHeader column="signal" label="Signal" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />}
                                    <SortableHeader column="tx_bytes" label="Upload" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="rx_bytes" label="Download" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="segment_name" label="Segment" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    <SortableHeader column="is_registered" label="Registered" align="center" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {sortedDevices.map((d) => (
                                    <TableRow key={d.ip} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                                        <TableCell>
                                            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 6px #22c55e' }} />
                                        </TableCell>
                                        <TableCell>
                                            {d.hostname || d.ip ? <Typography variant="body2">{d.hostname || d.ip}</Typography> : <Typography variant="body2" fontStyle="italic" color="text.secondary">Unknown</Typography>}
                                        </TableCell>
                                        <TableCell>{d.ip}</TableCell>
                                        <TableCell>{d.mac || '—'}</TableCell>
                                        <TableCell>
                                            {d.source === 'unifi' && <Chip size="small" label="UniFi" color="primary" />}
                                            {d.source === 'scan' && <Chip size="small" label="Scan" color="secondary" />}
                                            {d.source === 'ping' && <Chip size="small" label="Ping" sx={{ bgcolor: '#4b5563' }} />}
                                        </TableCell>
                                        <TableCell>
                                            {d.is_wired === true && <EthernetIcon fontSize="small" sx={{ color: '#22c55e' }} />}
                                            {d.is_wired === false && <WifiIcon fontSize="small" sx={{ color: '#06b6d4' }} />}
                                            {d.is_wired === null && <UnknownIcon fontSize="small" sx={{ color: '#888' }} />}
                                        </TableCell>
                                        {tab !== 'wired' && (
                                            <TableCell>
                                                {d.is_wired === false && d.signal ? `${d.signal} dBm` : '—'}
                                            </TableCell>
                                        )}
                                        <TableCell align="right">
                                            {d.source === 'unifi' ? formatBytes(d.tx_bytes) : '—'}
                                        </TableCell>
                                        <TableCell align="right">
                                            {d.source === 'unifi' ? formatBytes(d.rx_bytes) : '—'}
                                        </TableCell>
                                        <TableCell>
                                            {d.segment_name ? <Chip size="small" label={d.segment_name} variant="outlined" /> : '—'}
                                        </TableCell>
                                        <TableCell align="center">
                                            {d.is_registered ? (
                                                <Tooltip title="In devices list">
                                                    <CheckCircleIcon color="success" fontSize="small" />
                                                </Tooltip>
                                            ) : (
                                                <Button
                                                    variant="outlined"
                                                    size="small"
                                                    color="warning"
                                                    sx={{ textTransform: 'none', py: 0, fontSize: '0.75rem' }}
                                                    onClick={() => handleOpenSingleAdd(d)}
                                                >
                                                    Add
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {devices.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={10} align="center" sx={{ py: 3, color: 'text.secondary' }}>
                                            No live devices found for this filter.
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    )}
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary">
                        Showing {devices.length} devices · <span style={{ color: unregisteredCount > 0 ? '#f59e0b' : 'inherit' }}>{unregisteredCount} not yet registered</span>
                    </Typography>
                    <Button
                        variant="outlined"
                        color="warning"
                        disabled={unregisteredCount === 0 || bulkMutation.isLoading}
                        onClick={handleBulkRegister}
                    >
                        {bulkMutation.isLoading ? 'Registering...' : 'Register All Unregistered'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Embedded Single Add Dialog */}
            <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Add Device</DialogTitle>
                <DialogContent dividers>
                    <TextField
                        fullWidth label="Hostname (Optional)" margin="dense"
                        value={addFormData.hostname} onChange={e => setAddFormData({ ...addFormData, hostname: e.target.value })}
                    />
                    <TextField
                        fullWidth label="IP Address *" margin="dense" required
                        value={addFormData.ip_address} onChange={e => setAddFormData({ ...addFormData, ip_address: e.target.value })}
                    />
                    <TextField
                        fullWidth label="MAC Address (Optional)" margin="dense"
                        value={addFormData.mac_address} onChange={e => setAddFormData({ ...addFormData, mac_address: e.target.value })}
                    />
                    <TextField
                        select fullWidth label="Device Type" margin="dense"
                        value={addFormData.device_type} onChange={e => setAddFormData({ ...addFormData, device_type: e.target.value })}
                    >
                        {['router', 'switch', 'ap', 'server', 'workstation', 'printer', 'other'].map(t => (
                            <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>
                        ))}
                    </TextField>
                    <TextField
                        select fullWidth label="Segment (Optional)" margin="dense"
                        value={addFormData.segment_id} onChange={e => setAddFormData({ ...addFormData, segment_id: e.target.value })}
                    >
                        <MenuItem value=""><em>None</em></MenuItem>
                        {segmentsData?.segments?.map(s => <MenuItem key={s.id} value={s.id}>{s.name} ({s.cidr})</MenuItem>)}
                    </TextField>
                    <TextField
                        fullWidth label="Notes" margin="dense" multiline rows={3}
                        value={addFormData.notes} onChange={e => setAddFormData({ ...addFormData, notes: e.target.value })}
                    />
                    <FormControlLabel
                        sx={{ mt: 1 }}
                        control={<Switch checked={addFormData.is_critical} onChange={e => setAddFormData({ ...addFormData, is_critical: e.target.checked })} color="error" />}
                        label="Critical Device (triggers immediate alerts)"
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={() => singleAddMutation.mutate(addFormData)} disabled={!addFormData.ip_address}>
                        Save
                    </Button>
                </DialogActions>
            </Dialog>
        </>
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
