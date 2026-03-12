import React, { useState } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, FormControlLabel, Switch, Chip,
  IconButton, Tooltip, Drawer, Grid, Paper
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import { Add as AddIcon, Edit as EditIcon, Delete as DeleteIcon, Speed as PingIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';

export default function Devices() {
  const queryClient = useQueryClient();
  const [openAdd, setOpenAdd] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [formData, setFormData] = useState({
    hostname: '', ip_address: '', mac_address: '', device_type: 'other',
    segment_id: '', is_critical: false, notes: ''
  });

  const { data: devicesData, isLoading } = useQuery({
    queryKey: ['devices'],
    queryFn: () => axios.get('/api/v1/devices').then(res => res.data),
    refetchInterval: 10000
  });

  const { data: segmentsData } = useQuery({
    queryKey: ['segments'],
    queryFn: () => axios.get('/api/v1/segments').then(res => res.data)
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
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
      handleClose();
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => axios.put(`/api/v1/devices/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['devices']);
      handleClose();
    }
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

  const columns = [
    {
      field: 'status',
      headerName: 'Status',
      width: 80,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', pl: 2 }}>
          <Box sx={{
            width: 12, height: 12, borderRadius: '50%',
            bgcolor: params.value === 'up' ? 'success.main' : params.value === 'down' ? 'error.main' : 'warning.main',
            boxShadow: params.value === 'up' ? '0 0 8px #22c55e' : 'none'
          }} />
        </Box>
      )
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
    { field: 'device_type', headerName: 'Type', width: 120, textTransform: 'capitalize' },
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

  const devices = devicesData?.devices || [];
  const segments = segmentsData?.segments || [];

  return (
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
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

      <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
        <DataGrid
          rows={devices}
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
            {['router', 'switch', 'ap', 'server', 'workstation', 'printer', 'other'].map(t => (
              <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>
            ))}
          </TextField>
          <TextField
            select fullWidth label="Segment (Optional)" margin="dense"
            value={formData.segment_id} onChange={e => setFormData({ ...formData, segment_id: e.target.value })}
          >
            <MenuItem value=""><em>None</em></MenuItem>
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
                <Typography variant="body1">{selectedDevice.hostname || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">IP Address</Typography>
                <Typography variant="body1">{selectedDevice.ip_address}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">MAC Address</Typography>
                <Typography variant="body1">{selectedDevice.mac_address || 'N/A'}</Typography>
              </Grid>
              <Grid item xs={6}>
                <Typography variant="caption" color="text.secondary">Type</Typography>
                <Typography variant="body1" textTransform="capitalize">{selectedDevice.device_type}</Typography>
              </Grid>
            </Grid>

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
