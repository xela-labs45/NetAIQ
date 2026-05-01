import React, { useState, useEffect, useMemo, useRef } from 'react';
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
    UnfoldMore as UnfoldMoreIcon,
    AutoAwesome as AutoAwesomeIcon,
    ContentCopy as ContentCopyIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSocket } from '../hooks/useSocket';
import { DEVICE_TYPES, getDeviceTypeIcon } from '../constants/deviceTypes';
import { formatDistanceToNow } from 'date-fns';
import { useInfiniteDevices } from '../hooks/useInfiniteDevices';
import Lottie from 'lottie-react';
import subtleSpinnerAnimation from '../animations/subtleSpinner.json';
import emptyStateAnimation from '../animations/emptyState.json';
import radarPulseAnimation from '../animations/radarPulse.json';
import { Skeleton } from '@mui/material';

export default function LiveDevicesModal({ open, onClose, defaultTab = 'all' }) {
    const queryClient = useQueryClient();
    const socket = useSocket();
    const sentinelRef = useRef(null);

    // Main UI state
    const [mainTab, setMainTab] = useState('online'); // 'online' | 'discovered'
    const [connectionFilter, setConnectionFilter] = useState(defaultTab); // 'all' | 'wired' | 'wireless'

    // Discovered specific filters
    const [segmentFilter, setSegmentFilter] = useState('all');
    const [aiFilter, setAiFilter] = useState('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    // Sorting state (Online tab)
    const [sortBy, setSortBy] = useState('is_registered');
    const [sortDir, setSortDir] = useState('asc');

    // Sorting state (Discovered tab)
    const [discSortBy, setDiscSortBy] = useState('last_seen');
    const [discSortDir, setDiscSortDir] = useState('desc');

    // AI Batch Progress
    const [aiProgress, setAiProgress] = useState(null);

    // Single Add dialog
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [addFormData, setAddFormData] = useState({
        hostname: '', ip_address: '', mac_address: '',
        device_type: 'workstation', segment_id: '', is_critical: false, notes: 'Added from Live Devices'
    });

    const handleOpenSingleAdd = (device) => {
        setAddFormData({
            hostname: device.suggested_name || device.hostname || '',
            ip_address: device.ip || device.last_ip || '',
            mac_address: device.mac || device.mac_address || '',
            device_type: device.device_type_suggestion || 'workstation',
            segment_id: device.segment_id || '',
            is_critical: false,
            notes: 'Auto-registered from discovery popup'
        });
        setAddDialogOpen(true);
    };

    const handleBulkRegister = () => {
        const toRegister = onlineDevices.filter(d => !d.is_registered);
        if (toRegister.length === 0) return;
        bulkMutation.mutate({ devices: toRegister });
    };

    const { data: segmentsData } = useQuery({
        queryKey: ['segments'],
        queryFn: () => axios.get('/api/v1/segments').then(res => res.data),
        enabled: open
    });

    // Discovery capability — controls info banners
    const { data: capability } = useQuery({
        queryKey: ['discoveryCapability'],
        queryFn: () => axios.get('/api/v1/discovery/capability').then(res => res.data),
        enabled: open && mainTab === 'discovered',
        staleTime: 5 * 60 * 1000
    });

    // Handle deep linking from Dashboard cards where defaultTab controls both mainTab and connectionFilter
    useEffect(() => {
        if (open) {
            if (defaultTab === 'discovered_wired') {
                setMainTab('discovered');
                setConnectionFilter('wired');
            } else if (defaultTab === 'discovered_wireless') {
                setMainTab('discovered');
                setConnectionFilter('wireless');
            } else {
                setMainTab('online');
                setConnectionFilter(defaultTab);
            }
        }
    }, [open, defaultTab]);

    useEffect(() => {
        setSortBy('is_registered');
        setSortDir('asc');
    }, [connectionFilter]);

    // Infinite Devices for Online
    const {
        devices: onlineDevicesRaw,
        hasMore: onlineHasMore,
        loading: isOnlineFetching,
        initialLoading: onlineLoading,
        totalCount: onlineTotalCount,
        loadMore: loadMoreOnline,
        refetch: refetchOnline
    } = useInfiniteDevices('online', { connection: connectionFilter }, open && mainTab === 'online');

    // Infinite Devices for Discovered
    const {
        devices: discoveredDevicesRaw,
        hasMore: discoveredHasMore,
        loading: isDiscoveredFetching,
        initialLoading: discoveredLoading,
        totalCount: discoveredTotalCount,
        loadMore: loadMoreDiscovered,
        refetch: refetchDiscovered
    } = useInfiniteDevices('discovered', { 
        is_wired: connectionFilter === 'wired' ? 'true' : connectionFilter === 'wireless' ? 'false' : 'all',
        segment_id: segmentFilter,
        ai_identified: aiFilter === 'identified' ? 'true' : aiFilter === 'unidentified' ? 'false' : 'all',
        search: debouncedSearchQuery
    }, open && mainTab === 'discovered');

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting) {
                    if (mainTab === 'online' && onlineHasMore) loadMoreOnline();
                    if (mainTab === 'discovered' && discoveredHasMore) loadMoreDiscovered();
                }
            },
            { threshold: 0.1 }
        );
        if (sentinelRef.current) observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [mainTab, onlineHasMore, discoveredHasMore, loadMoreOnline, loadMoreDiscovered]);

    // Socket listeners for batch AI progress
    useEffect(() => {
        if (socket && open) {
            const handleIdentifyProgress = (data) => setAiProgress(data);
            const handleIdentifyComplete = (data) => {
                setAiProgress(null);
                refetchDiscovered();
                queryClient.invalidateQueries(['devices']);
            };
            socket.on('discovery:identify_progress', handleIdentifyProgress);
            socket.on('discovery:identify_complete', handleIdentifyComplete);
            return () => {
                socket.off('discovery:identify_progress', handleIdentifyProgress);
                socket.off('discovery:identify_complete', handleIdentifyComplete);
            };
        }
    }, [socket, open, refetchDiscovered, queryClient]);

    // Mutations
    const bulkMutation = useMutation({
        mutationFn: (payload) => axios.post('/api/v1/devices/bulk', payload),
        onSuccess: (res) => {
            queryClient.invalidateQueries({ queryKey: ['devices'] });
            queryClient.invalidateQueries({ queryKey: ['liveDevices'] });
            alert(`Success! Registered ${res.data.registered} devices. Skipped ${res.data.skipped}.`);
        }
    });

    const singleAddMutation = useMutation({
        mutationFn: (payload) => axios.post('/api/v1/devices', payload),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['devices'] });
            queryClient.invalidateQueries({ queryKey: ['liveDevices'] });
            setAddDialogOpen(false);
        }
    });

    const identifySingleMutation = useMutation({
        mutationFn: (mac) => axios.post('/api/v1/ai/identify-mac', { mac_address: mac }),
        onSuccess: () => refetchDiscovered()
    });

    const identifyAllMutation = useMutation({
        mutationFn: () => axios.post('/api/v1/discovery/identify-all')
    });

    // ==========================================
    // DATA PROCESSING - ONLINE TAB
    // ==========================================
    const onlineDevices = onlineDevicesRaw || [];

    const handleSort = (column) => {
        if (column === sortBy) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        else { setSortBy(column); setSortDir('asc'); }
    };

    const sortedOnlineDevices = useMemo(() => {
        if (!onlineDevices) return [];
        return [...onlineDevices].sort((a, b) => {
            let aVal = a[sortBy];
            let bVal = b[sortBy];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            if (typeof aVal === 'number' && typeof bVal === 'number') return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
            if (typeof aVal === 'boolean') return sortDir === 'asc' ? (aVal === bVal ? 0 : aVal ? 1 : -1) : (aVal === bVal ? 0 : aVal ? -1 : 1);
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [onlineDevices, sortBy, sortDir]);

    const unregisteredCount = onlineDevices.filter(d => !d.is_registered).length;

    // ==========================================
    // DATA PROCESSING - DISCOVERED TAB
    // ==========================================
    // Client-side search filter is now handled server-side
    const searchedDiscoveredDevices = discoveredDevicesRaw || [];

    const handleDiscSort = (column) => {
        if (column === discSortBy) setDiscSortDir(discSortDir === 'asc' ? 'desc' : 'asc');
        else { setDiscSortBy(column); setDiscSortDir('asc'); }
    };

    const sortedDiscoveredDevices = useMemo(() => {
        if (!searchedDiscoveredDevices) return [];
        return [...searchedDiscoveredDevices].sort((a, b) => {
            let aVal = a[discSortBy];
            let bVal = b[discSortBy];
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;

            // Special cases
            if (discSortBy === 'last_seen' || discSortBy === 'first_seen') {
                aVal = new Date(aVal).getTime();
                bVal = new Date(bVal).getTime();
                return discSortDir === 'asc' ? aVal - bVal : bVal - aVal;
            }

            if (typeof aVal === 'number' && typeof bVal === 'number') return discSortDir === 'asc' ? aVal - bVal : bVal - aVal;
            aVal = String(aVal).toLowerCase();
            bVal = String(bVal).toLowerCase();
            if (aVal < bVal) return discSortDir === 'asc' ? -1 : 1;
            if (aVal > bVal) return discSortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }, [searchedDiscoveredDevices, discSortBy, discSortDir]);

    const discoveredUnidentifiedCount = discoveredDevicesRaw.filter(d => d.ai_identified === false).length;
    const discoveredWiredCount = discoveredDevicesRaw.filter(d => d.is_wired === true).length;
    const discoveredWifiCount = discoveredDevicesRaw.filter(d => d.is_wired === false).length;

    // ==========================================
    // HELPERS
    // ==========================================
    const formatBytes = (bytes) => {
        if (bytes == null) return "—";
        if (bytes === 0) return '0 B';
        const k = 1000;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleCopy = (text) => {
        navigator.clipboard.writeText(text);
    };

    const sourceChipProps = (source) => {
        switch (source) {
            case 'unifi_wired': return { label: 'UniFi Wired', color: 'success' };
            case 'unifi_wifi': return { label: 'UniFi WiFi', color: 'info' };
            case 'unifi_historical': return { label: 'UniFi History', sx: { bgcolor: '#6b7280', color: 'white' } };
            case 'arp_scan': return { label: 'ARP Scan', color: 'secondary' };
            case 'ping': return { label: 'Ping', sx: { bgcolor: '#4b5563', color: 'white' } };
            default: return { label: source || 'Unknown', variant: 'outlined' };
        }
    };

    return (
        <>
            <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { bgcolor: '#111827', minHeight: '80vh' } }}>
                <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Typography variant="h6">Network Devices</Typography>
                            {aiProgress && (
                                <Chip
                                    icon={<CircularProgress size={14} sx={{ color: '#fff' }} />}
                                    label={`Identifying... ${aiProgress.current}/${aiProgress.total}`}
                                    color="warning"
                                    size="small"
                                />
                            )}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            View active connections or the comprehensive discovery registry
                        </Typography>
                    </Box>
                    <Box>
                        <IconButton onClick={() => mainTab === 'online' ? refetchOnline() : refetchDiscovered()} disabled={isOnlineFetching || isDiscoveredFetching} sx={{ mr: 1 }}>
                            <RefreshIcon />
                        </IconButton>
                        <IconButton onClick={onClose}>
                            <CloseIcon />
                        </IconButton>
                    </Box>
                </DialogTitle>

                {/* Main Tabs */}
                <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, bgcolor: 'rgba(0,0,0,0.2)' }}>
                    <Tabs value={mainTab} onChange={(e, v) => setMainTab(v)}>
                        <Tab 
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    Online Now
                                    <Chip size="small" label={onlineLoading && open && mainTab === 'online' ? <Skeleton width={20} /> : onlineTotalCount} />
                                </Box>
                            } 
                            value="online" 
                            sx={{ '&.Mui-selected': { color: '#22c55e' } }} 
                        />
                        <Tab 
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    All Discovered
                                    <Chip size="small" label={discoveredLoading && open && mainTab === 'discovered' ? <Skeleton width={20} /> : discoveredTotalCount} />
                                </Box>
                            } 
                            value="discovered" 
                            sx={{ '&.Mui-selected': { color: '#3b82f6' } }} 
                        />
                    </Tabs>
                </Box>

                {/* Filter Bars based on active Main Tab */}
                {mainTab === 'online' && (
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, bgcolor: 'rgba(255,255,255,0.02)' }}>
                        <Tabs value={connectionFilter} onChange={(e, v) => setConnectionFilter(v)} sx={{ minHeight: 40 }} indicatorColor="secondary">
                            <Tab label="All" value="all" sx={{ minHeight: 40, py: 0, '&.Mui-selected': { color: '#fff' } }} />
                            <Tab label="Wired" value="wired" sx={{ minHeight: 40, py: 0, '&.Mui-selected': { color: '#22c55e' } }} />
                            <Tab label="Wireless" value="wireless" sx={{ minHeight: 40, py: 0, '&.Mui-selected': { color: '#06b6d4' } }} />
                        </Tabs>
                    </Box>
                )}

                {mainTab === 'discovered' && (
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2, py: 1, bgcolor: 'rgba(255,255,255,0.02)', display: 'flex', gap: 2 }}>
                        <TextField
                            select size="small" label="Connection" value={connectionFilter} onChange={e => setConnectionFilter(e.target.value)} sx={{ width: 140 }}
                        >
                            <MenuItem value="all">All</MenuItem>
                            <MenuItem value="wired">Wired Only</MenuItem>
                            <MenuItem value="wireless">Wireless Only</MenuItem>
                        </TextField>

                        <TextField
                            select size="small" label="Segment" value={segmentFilter} onChange={e => setSegmentFilter(e.target.value)} sx={{ width: 180 }}
                        >
                            <MenuItem value="all">All Segments</MenuItem>
                            {segmentsData?.segments?.map(s => <MenuItem key={s.id} value={s.id}>{s.name}</MenuItem>)}
                        </TextField>

                        <TextField
                            select size="small" label="AI Status" value={aiFilter} onChange={e => setAiFilter(e.target.value)} sx={{ width: 150 }}
                        >
                            <MenuItem value="all">All Status</MenuItem>
                            <MenuItem value="identified">Identified</MenuItem>
                            <MenuItem value="unidentified">Unidentified</MenuItem>
                        </TextField>

                        <TextField
                            size="small" label="Search MAC, IP, Name..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} sx={{ flexGrow: 1 }}
                        />
                    </Box>
                )}

                <DialogContent sx={{ p: 0, height: '60vh' }}>

                    {/* ONLINE TAB RENDER */}
                    {mainTab === 'online' && (
                        <>
                        {onlineLoading ? (
                            <Box sx={{ p: 2 }}>
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} variant="rectangular" height={52} sx={{ mb: 1, borderRadius: 1 }} />
                                ))}
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
                                        {connectionFilter !== 'wired' && <SortableHeader column="signal" label="Signal" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />}
                                        <SortableHeader column="tx_bytes" label="Upload" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                        <SortableHeader column="rx_bytes" label="Download" align="right" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                        <SortableHeader column="segment_name" label="Segment" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                        <SortableHeader column="is_registered" label="Registered" align="center" sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {sortedOnlineDevices.map((d) => (
                                        <TableRow key={d.ip} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                                            <TableCell><Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'success.main', boxShadow: '0 0 6px #22c55e' }} /></TableCell>
                                            <TableCell>{d.hostname || d.ip ? <Typography variant="body2">{d.hostname || d.ip}</Typography> : <Typography variant="body2" fontStyle="italic" color="text.secondary">Unknown</Typography>}</TableCell>
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
                                            </TableCell>
                                            {connectionFilter !== 'wired' && <TableCell>{d.is_wired === false && d.signal ? `${d.signal} dBm` : '—'}</TableCell>}
                                            <TableCell align="right">{d.source === 'unifi' ? formatBytes(d.tx_bytes) : '—'}</TableCell>
                                            <TableCell align="right">{d.source === 'unifi' ? formatBytes(d.rx_bytes) : '—'}</TableCell>
                                            <TableCell>{d.segment_name ? <Chip size="small" label={d.segment_name} variant="outlined" /> : '—'}</TableCell>
                                            <TableCell align="center">
                                                {d.is_registered ? <Tooltip title="In devices list"><CheckCircleIcon color="success" fontSize="small" /></Tooltip> :
                                                    <Button variant="outlined" size="small" color="warning" sx={{ textTransform: 'none', py: 0, fontSize: '0.75rem' }} onClick={() => handleOpenSingleAdd(d)}>Add</Button>
                                                }
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {onlineDevices.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'text.secondary' }}>
                                                    <Lottie animationData={emptyStateAnimation} style={{ width: 100, height: 100 }} loop={false} />
                                                    <Typography variant="body2" sx={{ mt: 2 }}>No live devices found</Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        )}
                        {isOnlineFetching && !onlineLoading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <Lottie animationData={subtleSpinnerAnimation} style={{ width: 40, height: 40 }} loop={true} />
                            </Box>
                        )}
                        <div ref={sentinelRef} style={{ height: 1 }} />
                        </>
                    )}

                    {/* DISCOVERED TAB RENDER */}
                    {mainTab === 'discovered' && (
                        <>
                        {/* Capability info banner */}
                        {capability && (
                            <Box sx={{ px: 2, py: 1, bgcolor: capability.can_arp_scan ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)', borderBottom: 1, borderColor: 'divider' }}>
                                <Typography variant="caption" sx={{ color: capability.can_arp_scan ? '#22c55e' : '#f59e0b' }}>
                                    {capability.can_arp_scan
                                        ? `MAC discovery active · L2 segment ${capability.l2_segment?.cidr || 'detected'} · WiFi via UniFi`
                                        : `WiFi MACs via UniFi only${capability.platform_note ? ' · ' + capability.platform_note : ''}`
                                    }
                                </Typography>
                            </Box>
                        )}
                        {discoveredLoading ? (
                            <Box sx={{ p: 2 }}>
                                {Array.from({ length: 5 }).map((_, i) => (
                                    <Skeleton key={i} variant="rectangular" height={52} sx={{ mb: 1, borderRadius: 1 }} />
                                ))}
                            </Box>
                        ) : (
                            <Table stickyHeader size="small">
                                <TableHead>
                                    <TableRow>
                                        <TableCell width={30}></TableCell>
                                        <SortableHeader column="hostname" label="Device" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="mac_address" label="MAC Address" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="last_ip" label="Last IP" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="is_wired" label="Conn" align="center" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="segment_name" label="Segment" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="source" label="Source" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="ai_identified" label="AI Status" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="last_seen" label="Last Seen" align="right" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                        <SortableHeader column="is_registered" label="Reg" align="center" sortBy={discSortBy} sortDir={discSortDir} onSort={handleDiscSort} />
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {sortedDiscoveredDevices.map((d) => {
                                        const newlySeen = new Date() - new Date(d.last_seen) < 300000; // < 5 mins
                                        const aiChipColor = d.confidence === 'high' ? 'success' : d.confidence === 'medium' ? 'warning' : 'default';

                                        return (
                                            <TableRow key={d.mac_address} hover sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                                                <TableCell>
                                                    <Tooltip title={newlySeen ? 'Seen recently' : 'Offline'}>
                                                        <Box sx={{
                                                            width: 8, height: 8, borderRadius: '50%',
                                                            bgcolor: newlySeen ? 'success.main' : 'text.disabled',
                                                            boxShadow: newlySeen ? '0 0 6px #22c55e' : 'none'
                                                        }} />
                                                    </Tooltip>
                                                </TableCell>
                                                <TableCell sx={{ minWidth: 200 }}>
                                                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                                                        {d.suggested_name || d.hostname || 'Unknown Device'}
                                                    </Typography>
                                                    <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                                                        <Chip size="small" label={d.manufacturer || d.vendor || 'Unknown Provider'} sx={{ height: 16, fontSize: '0.65rem' }} />
                                                        {d.device_type_suggestion && <Chip size="small" label={d.device_type_suggestion} variant="outlined" sx={{ height: 16, fontSize: '0.65rem' }} />}
                                                    </Box>
                                                </TableCell>
                                                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                                                    {d.mac_address}
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="body2">{d.last_ip}</Typography>
                                                </TableCell>
                                                <TableCell align="center">
                                                    {d.is_wired === true && <EthernetIcon fontSize="small" sx={{ color: '#22c55e' }} />}
                                                    {d.is_wired === false && <WifiIcon fontSize="small" sx={{ color: '#06b6d4' }} />}
                                                    {d.is_wired === null && <UnknownIcon fontSize="small" color="disabled" />}
                                                </TableCell>
                                                <TableCell>
                                                    {d.segment_name ? <Chip size="small" label={d.segment_name} sx={{ bgcolor: d.segment_color || 'default' }} /> : '—'}
                                                </TableCell>
                                                <TableCell>
                                                    <Chip size="small" {...sourceChipProps(d.source)} sx={{ height: 20, fontSize: '0.7rem' }} />
                                                </TableCell>
                                                <TableCell>
                                                    {d.ai_identified === 1 ? (
                                                        <Tooltip title={d.reasoning} placement="top" arrow>
                                                            <Box>
                                                                <Chip size="small" icon={<AutoAwesomeIcon sx={{ fontSize: '12px !important' }} />} label={`${d.confidence} conf`} color={aiChipColor} variant="outlined" sx={{ height: 20, fontSize: '0.7rem', fontWeight: 'bold' }} />
                                                                {d.os_guess && <Typography variant="caption" sx={{ display: 'block', mt: 0.3, color: 'text.secondary' }}>OS: {d.os_guess}</Typography>}
                                                            </Box>
                                                        </Tooltip>
                                                    ) : (
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            color="inherit"
                                                            sx={{ fontSize: '0.7rem', py: 0, textTransform: 'none' }}
                                                            onClick={() => identifySingleMutation.mutate(d.mac_address)}
                                                            disabled={identifySingleMutation.isPending && identifySingleMutation.variables === d.mac_address}
                                                        >
                                                            {identifySingleMutation.isPending && identifySingleMutation.variables === d.mac_address ? 'Identifying...' : 'Identify'}
                                                        </Button>
                                                    )}
                                                </TableCell>
                                                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                                    <Tooltip title={`First seen: ${new Date(d.first_seen).toLocaleString()}\nLast seen: ${new Date(d.last_seen).toLocaleString()}`}>
                                                        <Typography variant="body2" sx={{ cursor: 'help' }}>
                                                            {formatDistanceToNow(new Date(d.last_seen), { addSuffix: true })}
                                                        </Typography>
                                                    </Tooltip>
                                                </TableCell>
                                                <TableCell align="center">
                                                    {d.is_registered ? (
                                                        <CheckCircleIcon color="success" fontSize="small" />
                                                    ) : (
                                                        <Button
                                                            variant="outlined"
                                                            size="small"
                                                            color="warning"
                                                            sx={{ textTransform: 'none', py: 0, fontSize: '0.7rem' }}
                                                            onClick={() => handleOpenSingleAdd(d)}
                                                        >
                                                            Add
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                    {sortedDiscoveredDevices.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={10} align="center" sx={{ py: 6 }}>
                                                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'text.secondary' }}>
                                                    <Lottie animationData={emptyStateAnimation} style={{ width: 100, height: 100 }} loop={false} />
                                                    <Typography variant="body2" sx={{ mt: 2 }}>No devices found</Typography>
                                                </Box>
                                            </TableCell>
                                        </TableRow>
                                    )}
                                </TableBody>
                            </Table>
                        )}
                        {isDiscoveredFetching && !discoveredLoading && (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                                <Lottie animationData={subtleSpinnerAnimation} style={{ width: 40, height: 40 }} loop={true} />
                            </Box>
                        )}
                        <div ref={sentinelRef} style={{ height: 1 }} />
                    </> )}
                </DialogContent>

                <DialogActions sx={{ justifyContent: 'space-between', p: 2, borderTop: 1, borderColor: 'divider', bgcolor: 'rgba(0,0,0,0.2)' }}>
                    {mainTab === 'online' ? (
                        <>
                            <Typography variant="body2" color="text.secondary">
                                Showing {onlineDevices.length} devices · <span style={{ color: unregisteredCount > 0 ? '#f59e0b' : 'inherit' }}>{unregisteredCount} not yet registered</span>
                            </Typography>
                            <Button variant="contained" color="warning" disabled={unregisteredCount === 0 || bulkMutation.isPending} onClick={handleBulkRegister}>
                                {bulkMutation.isPending ? 'Registering...' : 'Register Loaded Unregistered'}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Typography variant="body2" color="text.secondary">
                                {discoveredDevicesRaw.length} devices ever seen · {discoveredWifiCount} WiFi · {discoveredWiredCount} wired · {discoveredUnidentifiedCount} pending identification
                            </Typography>
                            <Button
                                variant="outlined"
                                color="secondary"
                                onClick={() => identifyAllMutation.mutate()}
                                disabled={discoveredUnidentifiedCount === 0 || identifyAllMutation.isPending || aiProgress}
                                startIcon={<AutoAwesomeIcon />}
                            >
                                {identifyAllMutation.isPending || aiProgress ? 'Batch Identify In Progress...' : `Identify All Unidentified (${discoveredUnidentifiedCount})`}
                            </Button>
                        </>
                    )}
                </DialogActions>
            </Dialog>

            {/* Existing single add dialog code */}
            <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Add Device</DialogTitle>
                <DialogContent dividers>
                    <TextField fullWidth label="Hostname (Optional)" margin="dense" value={addFormData.hostname} onChange={e => setAddFormData({ ...addFormData, hostname: e.target.value })} />
                    <TextField fullWidth label="IP Address *" margin="dense" required value={addFormData.ip_address} onChange={e => setAddFormData({ ...addFormData, ip_address: e.target.value })} />
                    <TextField fullWidth label="MAC Address (Optional)" margin="dense" value={addFormData.mac_address} onChange={e => setAddFormData({ ...addFormData, mac_address: e.target.value })} />
                    <TextField select fullWidth label="Device Type" margin="dense" value={addFormData.device_type} onChange={e => setAddFormData({ ...addFormData, device_type: e.target.value })}>
                        {DEVICE_TYPES.map((type) => (
                            <MenuItem key={type.value} value={type.value}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>{React.createElement(getDeviceTypeIcon(type.value), { fontSize: 'small', color: 'action' })}{type.label}</Box>
                            </MenuItem>
                        ))}
                    </TextField>
                    <TextField select fullWidth label="Segment (Optional)" margin="dense" value={addFormData.segment_id} onChange={e => setAddFormData({ ...addFormData, segment_id: e.target.value })}>
                        <MenuItem value=""><em>None</em></MenuItem>
                        {segmentsData?.segments?.map(s => <MenuItem key={s.id} value={s.id}>{s.name} ({s.cidr})</MenuItem>)}
                    </TextField>
                    <TextField fullWidth label="Notes" margin="dense" multiline rows={3} value={addFormData.notes} onChange={e => setAddFormData({ ...addFormData, notes: e.target.value })} />
                    <FormControlLabel sx={{ mt: 1 }} control={<Switch checked={addFormData.is_critical} onChange={e => setAddFormData({ ...addFormData, is_critical: e.target.checked })} color="error" />} label="Critical Device" />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddDialogOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={() => singleAddMutation.mutate(addFormData)} disabled={!addFormData.ip_address}>Save</Button>
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
                    sortDir === 'asc' ? <ArrowUpwardIcon sx={{ fontSize: 14 }} /> : <ArrowDownwardIcon sx={{ fontSize: 14 }} />
                ) : (
                    <UnfoldMoreIcon sx={{ fontSize: 14, opacity: 0.3 }} />
                )}
            </Box>
        </TableCell>
    );
}
