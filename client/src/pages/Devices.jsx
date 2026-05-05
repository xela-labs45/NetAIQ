import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, FormControlLabel, Switch, Chip,
  IconButton, Tooltip, Drawer, Grid, Paper, Tabs, Tab, Snackbar, Alert
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon,
  Speed as PingIcon, Refresh as RefreshIcon,
  SettingsEthernet as EthernetIcon, Wifi as WifiIcon,
  HelpOutline as UnknownIcon, AutoAwesome as AutoAwesomeIcon
} from '@mui/icons-material';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { DEVICE_TYPES, getDeviceTypeIcon } from '../constants/deviceTypes';

export default function Devices() {
  const queryClient = useQueryClient();
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filterTab, setFilterTab] = useState(0); // 0=All, 1=Wired, 2=Wireless, 3=Unknown, 4=Offline

  const [formData, setFormData] = useState({
    hostname: '', ip_address: '', mac_address: '', device_type: 'other',
    segment_id: '', is_critical: false, notes: ''
  });
  const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });
  const showToast = (message, severity = 'success') => setToast({ open: true, message, severity });

  const { data: devicesData, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => axios.get('/api/v1/devices').then(res => res.data),
    refetchInterval: 10000
  });

  const { data: segmentsData } = useQuery({
    queryKey: ['segments'],
    queryFn: () => axios.get('/api/v1/segments').then(res => res.data)
  });

  // Merged online devices for cross-referencing status — fetch all (limit=0) so every device gets is_wired
  const { data: onlineData } = useQuery({
    queryKey: ['devices', 'online'],
    queryFn: () => axios.get('/api/v1/devices/online?limit=0').then(res => res.data),
    refetchInterval: 10000
  });

  const { data: deviceHistory } = useQuery({
    queryKey: ['deviceHistory', selectedDevice?.id],
    queryFn: () => axios.get(`/api/v1/devices/${selectedDevice.id}/history?hours=24`).then(res => res.data),
    enabled: !!selectedDevice && drawerOpen,
    refetchInterval: 60000
  });

  const { data: deviceUptime } = useQuery({
    queryKey: ['deviceUptime', selectedDevice?.id],
    queryFn: () => axios.get(`/api/v1/devices/${selectedDevice.id}/uptime`).then(res => res.data),
    enabled: !!selectedDevice && drawerOpen,
    refetchInterval: 60000
  });

  const addMutation = useMutation({
    mutationFn: (newDevice) => axios.post('/api/v1/devices', newDevice),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['devices']);
      if (res.data.autoDetectedSegment) {
        showToast(`Device added — automatically placed in segment "${res.data.autoDetectedSegment.name}" (${res.data.autoDetectedSegment.cidr})`, 'info');
      } else {
        showToast('Device added successfully');
      }
      handleClose();
    },
    onError: (err) => showToast(err.response?.data?.message || 'Failed to add device', 'error')
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => axios.put(`/api/v1/devices/${id}`, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['devices']);
      if (res.data.autoDetectedSegment) {
        showToast(`Device updated — automatically placed in segment "${res.data.autoDetectedSegment.name}" (${res.data.autoDetectedSegment.cidr})`, 'info');
      } else {
        showToast('Device updated successfully');
      }
      handleClose();
    },
    onError: (err) => showToast(err.response?.data?.message || 'Failed to update device', 'error')
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => axios.delete(`/api/v1/devices/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['devices'])
  });

  const pingMutation = useMutation({
    mutationFn: (id) => axios.post(`/api/v1/devices/${id}/ping`),
    onSuccess: () => queryClient.invalidateQueries(['devices'])
  });

  const handleOpenAdd = () => {
    setSelectedDevice(null);
    setFormData({
      hostname: '', ip_address: '', mac_address: '', device_type: 'other',
      segment_id: '', is_critical: false, notes: ''
    });
    setOpenAdd(true);
  };

  const handleOpenEdit = (device, e) => {
    e.stopPropagation();
    setSelectedDevice(device);
    setFormData({
      hostname: device.hostname || '',
      ip_address: device.ip_address || '',
      mac_address: device.mac_address || '',
      device_type: device.device_type || 'other',
      segment_id: device.segment_id || '',
      is_critical: device.is_critical === 1,
      notes: device.notes || ''
    });
    setOpenAdd(true);
  };

  const handleDelete = (id, e) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this device?')) {
      deleteMutation.mutate(id);
    }
  };

  const handlePing = (id, e) => {
    e.stopPropagation();
    pingMutation.mutate(id);
  };

  const handleClose = () => {
    setOpenAdd(false);
  };

  const handleSave = () => {
    if (selectedDevice) {
      updateMutation.mutate({ id: selectedDevice.id, data: formData });
    } else {
      addMutation.mutate(formData);
    }
  };

  const handleRowClick = (params) => {
    setSelectedDevice(params.row);
    setDrawerOpen(true);
  };

  const devices = devicesData?.devices || [];
  const segments = segmentsData?.segments || [];

  // Build IP → merged-online-entry lookup
  const onlineLookup = useMemo(() => {
    const map = new Map();
    for (const d of (onlineData?.devices || [])) {
      map.set(d.ip, d);
    }
    return map;
  }, [onlineData]);

  // Enrich devices with is_wired from merged data
  const enrichedDevices = useMemo(() => {
    return devices.map(d => {
      const merged = onlineLookup.get(d.ip_address);
      const dbIsWired = d.is_wired === 1 || d.is_wired === true ? true : (d.is_wired === 0 || d.is_wired === false ? false : null);
      return {
        ...d,
        is_wired: merged && merged.is_wired !== undefined && merged.is_wired !== null ? merged.is_wired : dbIsWired,
        merged_source: merged?.source || null,
      };
    });
  }, [devices, onlineLookup]);

  // Filter devices by tab
  const filteredDevices = useMemo(() => {
    switch (filterTab) {
      case 1: // Wired
        return enrichedDevices.filter(d => d.is_wired === true);
      case 2: // Wireless
        return enrichedDevices.filter(d => d.is_wired === false);
      case 3: // Unknown
        return enrichedDevices.filter(d => d.is_wired === null && d.status !== 'down');
      case 4: // Offline
        return enrichedDevices.filter(d => d.status === 'down');
      default: // All
        return enrichedDevices;
    }
  }, [enrichedDevices, filterTab]);

  // Count devices per filter for badge labels
  const filterCounts = useMemo(() => ({
    all: enrichedDevices.length,
    wired: enrichedDevices.filter(d => d.is_wired === true).length,
    wireless: enrichedDevices.filter(d => d.is_wired === false).length,
    unknown: enrichedDevices.filter(d => d.is_wired === null && d.status !== 'down').length,
    offline: enrichedDevices.filter(d => d.status === 'down').length,
  }), [enrichedDevices]);

  const columns = [
    {
      field: 'status',
      headerName: 'Status',
      width: 80,
      renderCell: (params) => {
        const mergedEntry = onlineLookup.get(params.row.ip_address);
        const effectiveStatus = mergedEntry ? 'up' : (params.value || null);
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', pl: 2 }}>
            <Box sx={{
              width: 12, height: 12, borderRadius: '50%',
              bgcolor: effectiveStatus === 'up' ? 'success.main' : effectiveStatus === 'down' ? 'error.main' : 'warning.main',
              boxShadow: effectiveStatus === 'up' ? '0 0 8px #22c55e' : 'none'
            }} />
          </Box>
        );
      }
    },
    {
      field: 'connection',
      headerName: 'Connection',
      width: 130,
      renderCell: (params) => {
        const isWired = params.row.is_wired;
        if (isWired === true) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.5 }}>
              <EthernetIcon fontSize="small" sx={{ color: '#22c55e' }} />
              <Typography variant="body2" sx={{ color: '#22c55e' }}>Wired</Typography>
            </Box>
          );
        }
        if (isWired === false) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.5 }}>
              <WifiIcon fontSize="small" sx={{ color: '#06b6d4' }} />
              <Typography variant="body2" sx={{ color: '#06b6d4' }}>WiFi</Typography>
            </Box>
          );
        }
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.5 }}>
            <UnknownIcon fontSize="small" sx={{ color: '#888' }} />
            <Typography variant="body2" sx={{ color: '#888' }}>Unknown</Typography>
          </Box>
        );
      }
    },
    { field: 'hostname', headerName: 'Hostname', flex: 1 },
    { field: 'ip_address', headerName: 'IP Address', flex: 1 },
    {
      field: 'segment_name',
      headerName: 'Segment',
      flex: 1,
      renderCell: (params) => params.row.segment_name ? (
        <Chip
          label={params.row.segment_name}
          size="small"
          sx={{ bgcolor: params.row.segment_color + '40', color: params.row.segment_color, borderColor: params.row.segment_color, border: '1px solid' }}
        />
      ) : '-'
    },
    {
      field: 'device_type',
      headerName: 'Type',
      width: 220,
      renderCell: (params) => {
        const typeObj = DEVICE_TYPES.find(t => t.value === params.row.device_type);
        const label = typeObj ? typeObj.label : params.row.device_type;
        const Icon = getDeviceTypeIcon(params.row.device_type);
        const mfr = params.row.ai_manufacturer;
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Icon fontSize="small" sx={{ color: 'text.secondary', flexShrink: 0 }} />
            <Typography variant="body2">{label}</Typography>
            {mfr && !mfr.startsWith('Unknown') && (
              <Chip
                size="small"
                label={mfr}
                color="primary"
                variant="outlined"
                sx={{ height: 18, fontSize: '0.6rem', fontWeight: 600 }}
              />
            )}
          </Box>
        );
      }
    },
    {
      field: 'is_critical',
      headerName: 'Critical',
      width: 100,
      renderCell: (params) => params.value ? <Chip label="Yes" color="error" size="small" /> : 'No'
    },
    { field: 'latency_ms', headerName: 'Latency', width: 100, renderCell: (params) => params.value ? `${params.value} ms` : '-' },
    {
      field: 'last_seen',
      headerName: 'Last Seen',
      flex: 1,
      renderCell: (params) => params.value ? new Date(params.value).toLocaleString() : 'Never'
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 150,
      sortable: false,
      renderCell: (params) => (
        <Box>
          <Tooltip title="Ping Now">
            <IconButton size="small" color="primary" onClick={(e) => handlePing(params.row.id, e)}><PingIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Edit">
            <IconButton size="small" color="info" onClick={(e) => handleOpenEdit(params.row, e)}><EditIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" color="error" onClick={(e) => handleDelete(params.row.id, e)}><DeleteIcon fontSize="small" /></IconButton>
          </Tooltip>
        </Box>
      )
    }
  ];

  return (
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" fontWeight="bold">Devices</Typography>
        <Box>
          <Button startIcon={<RefreshIcon />} onClick={() => queryClient.invalidateQueries(['devices'])} sx={{ mr: 2 }}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd}>
            Add Device
          </Button>
        </Box>
      </Box>

      {/* Filter Tabs */}
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={filterTab} onChange={(e, v) => setFilterTab(v)} aria-label="device filter tabs">
          <Tab label={`All (${filterCounts.all})`} />
          <Tab label={`Wired (${filterCounts.wired})`} icon={<EthernetIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
          <Tab label={`Wireless (${filterCounts.wireless})`} icon={<WifiIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
          <Tab label={`Unknown (${filterCounts.unknown})`} icon={<UnknownIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
          <Tab label={`Offline (${filterCounts.offline})`} sx={{ color: filterCounts.offline > 0 ? 'error.main' : undefined }} />
        </Tabs>
      </Box>

      <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
        <DataGrid
          rows={filteredDevices}
          columns={columns}
          initialState={{
            pagination: { paginationModel: { pageSize: 25 } },
          }}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
          onRowClick={handleRowClick}
          loading={isLoading}
          sx={{
            border: 'none',
            '& .MuiDataGrid-cell:focus': { outline: 'none' },
            '& .MuiDataGrid-row': { cursor: 'pointer' },
            '& .MuiDataGrid-columnHeaders': { backgroundColor: 'rgba(255,255,255,0.02)' }
          }}
        />
      </Box>

      {/* Add/Edit Dialog */}
      <Dialog open={openAdd} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{selectedDevice ? 'Edit Device' : 'Add Device'}</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth label="Hostname (Optional)" margin="dense"
            value={formData.hostname} onChange={e => setFormData({ ...formData, hostname: e.target.value })}
          />
          <TextField
            fullWidth label="IP Address *" margin="dense" required
            value={formData.ip_address} onChange={e => setFormData({ ...formData, ip_address: e.target.value })}
          />
          <TextField
            fullWidth label="MAC Address (Optional)" margin="dense"
            value={formData.mac_address} onChange={e => setFormData({ ...formData, mac_address: e.target.value })}
          />
          <TextField
            select fullWidth label="Device Type" margin="dense"
            value={formData.device_type} onChange={e => setFormData({ ...formData, device_type: e.target.value })}
          >
            {DEVICE_TYPES.map((type) => (
              <MenuItem key={type.value} value={type.value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {React.createElement(getDeviceTypeIcon(type.value), { fontSize: 'small', color: 'action' })}
                  {type.label}
                </Box>
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select fullWidth label="Segment (Optional)" margin="dense"
            value={formData.segment_id} onChange={e => setFormData({ ...formData, segment_id: e.target.value })}
            helperText="Leave blank to auto-detect from IP. External IPs (e.g. 8.8.8.8) will be saved without a segment."
          >
            <MenuItem value=""><em>Auto-detect from IP</em></MenuItem>
            {segments.map(s => <MenuItem key={s.id} value={s.id}>{s.name} ({s.cidr})</MenuItem>)}
          </TextField>
          <TextField
            fullWidth label="Notes" margin="dense" multiline rows={3}
            value={formData.notes} onChange={e => setFormData({ ...formData, notes: e.target.value })}
          />
          <FormControlLabel
            sx={{ mt: 1 }}
            control={<Switch checked={formData.is_critical} onChange={e => setFormData({ ...formData, is_critical: e.target.checked })} color="error" />}
            label="Critical Device (triggers immediate alerts)"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!formData.ip_address}>Save</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast.open}
        autoHideDuration={5000}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>

      {/* Device Detail Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{ sx: { width: 500, p: 3, bgcolor: 'background.paper', backgroundImage: 'none', borderLeft: '1px solid rgba(255,255,255,0.08)' } }}
      >
        {selectedDevice && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Typography variant="h5" fontWeight="bold">Device Details</Typography>
              <Chip
                label={selectedDevice.status === 'up' ? 'ONLINE' : 'OFFLINE'}
                color={selectedDevice.status === 'up' ? 'success' : 'error'}
              />
            </Box>

            <Grid container spacing={2} sx={{ mb: 4 }}>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Hostname</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>{selectedDevice.hostname || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">IP Address</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium' }}>{selectedDevice.ip_address}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">MAC Address</Typography>
                <Typography variant="body1" sx={{ fontWeight: 'medium', fontFamily: 'monospace' }}>{selectedDevice.mac_address || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Type</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  {React.createElement(getDeviceTypeIcon(selectedDevice.device_type), { fontSize: 'small', color: 'action' })}
                  <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                    {DEVICE_TYPES.find(t => t.value === selectedDevice.device_type)?.label || selectedDevice.device_type}
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            {/* AI Identification Section (NEW) */}
            {selectedDevice.ai_manufacturer && (
              <Box sx={{ mb: 4, p: 2, borderRadius: 2, bgcolor: 'rgba(37, 99, 235, 0.05)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ color: 'primary.main', display: 'flex' }}><AutoAwesomeIcon fontSize="small" /></Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold', color: 'primary.main', letterSpacing: 0.5 }}>AI IDENTIFICATION</Typography>
                  </Box>
                  <Chip
                    label={`${selectedDevice.ai_confidence?.toUpperCase()} CONFIDENCE`}
                    size="small"
                    variant="outlined"
                    color={selectedDevice.ai_confidence === 'high' ? 'success' : selectedDevice.ai_confidence === 'medium' ? 'warning' : 'default'}
                    sx={{ fontSize: '0.65rem', height: 20, fontWeight: 'bold' }}
                  />
                </Box>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">Suggested Manufacturer</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedDevice.ai_manufacturer}</Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="caption" color="text.secondary">OS Guess</Typography>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>{selectedDevice.ai_os || 'Unknown'}</Typography>
                  </Grid>
                  <Grid item xs={12}>
                    <Typography variant="caption" color="text.secondary">AI Reasoning</Typography>
                    <Typography variant="body2" sx={{ fontStyle: 'italic', color: 'text.secondary', mt: 0.5 }}>
                      "{selectedDevice.ai_reasoning}"
                    </Typography>
                  </Grid>
                </Grid>
              </Box>
            )}


            {deviceUptime && (
              <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid item xs={6}>
                  <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'rgba(255,255,255,0.03)' }}>
                    <Typography variant="caption" color="text.secondary">24H Uptime</Typography>
                    <Typography variant="h5" color={deviceUptime.uptime_24h > 99 ? 'success.main' : 'warning.main'}>
                      {deviceUptime.uptime_24h.toFixed(2)}%
                    </Typography>
                  </Paper>
                </Grid>
                <Grid item xs={6}>
                  <Paper sx={{ p: 2, textAlign: 'center', bgcolor: 'rgba(255,255,255,0.03)' }}>
                    <Typography variant="caption" color="text.secondary">7D Uptime</Typography>
                    <Typography variant="h5" color={deviceUptime.uptime_7d > 99 ? 'success.main' : 'warning.main'}>
                      {deviceUptime.uptime_7d.toFixed(2)}%
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>
            )}

            <Typography variant="h6" gutterBottom>24h Latency History</Typography>
            <Box sx={{ height: 250, mb: 4 }}>
              {deviceHistory?.history?.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={deviceHistory.history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(tick) => format(new Date(tick), 'HH:mm')}
                      stroke="#888"
                    />
                    <YAxis
                      dataKey="latency_ms"
                      stroke="#888"
                      domain={[0, 'auto']}
                    />
                    <RechartsTooltip
                      labelFormatter={(label) => format(new Date(label), 'MMM dd HH:mm:ss')}
                      contentStyle={{ backgroundColor: '#111827', borderColor: '#3b82f6' }}
                    />
                    <Line type="monotone" dataKey="latency_ms" stroke="#3b82f6" dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Typography color="text.secondary">No ping history data available.</Typography>
                </Box>
              )}
            </Box>

            {selectedDevice.notes && (
              <Box>
                <Typography variant="h6" gutterBottom>Notes</Typography>
                <Paper sx={{ p: 2, bgcolor: 'rgba(255,255,255,0.03)' }}>
                  <Typography variant="body2">{selectedDevice.notes}</Typography>
                </Paper>
              </Box>
            )}
          </Box>
        )}
      </Drawer>

    </Box>
  );
}
