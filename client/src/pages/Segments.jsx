import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Grid, Card, LinearProgress, Accordion,
  AccordionSummary, AccordionDetails, Chip, CircularProgress
} from '@mui/material';
import {
  Add as AddIcon, ExpandMore as ExpandMoreIcon,
  WifiTethering as ScanIcon, Delete as DeleteIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useSocket } from '../hooks/useSocket';

export default function Segments() {
  const queryClient = useQueryClient();
  const socket = useSocket();
  const [openAdd, setOpenAdd] = useState(false);
  const [formData, setFormData] = useState({ name: '', cidr: '', description: '', color: '#3b82f6' });
  const [scanProgress, setScanProgress] = useState({}); // { [segmentId]: { scanned, total, status, current_ip } }
  const [expandedScans, setExpandedScans] = useState({});

  useEffect(() => {
    if (socket) {
      const handleProgress = (data) => {
        setScanProgress(prev => ({
          ...prev,
          [data.segment_id]: data
        }));
      };

      const handleComplete = (data) => {
        setScanProgress(prev => {
          const newState = { ...prev };
          delete newState[data.segment_id];
          return newState;
        });
        queryClient.invalidateQueries(['segments']);
        queryClient.invalidateQueries(['scans', data.segment_id]);
      };

      socket.on('scan:progress', handleProgress);
      socket.on('scan:complete', handleComplete);

      return () => {
        socket.off('scan:progress', handleProgress);
        socket.off('scan:complete', handleComplete);
      };
    }
  }, [socket, queryClient]);

  const { data: segmentsData, isLoading } = useQuery({
    queryKey: ['segments'],
    queryFn: () => axios.get('/api/v1/segments').then(res => res.data),
    refetchInterval: 30000
  });

  const addMutation = useMutation({
    mutationFn: (newSeg) => axios.post('/api/v1/segments', newSeg),
    onSuccess: () => {
      queryClient.invalidateQueries(['segments']);
      handleClose();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => axios.delete(`/api/v1/segments/${id}`),
    onSuccess: () => queryClient.invalidateQueries(['segments'])
  });

  const handleScan = async (id) => {
    try {
      await axios.post(`/api/v1/segments/${id}/scan`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start scan');
    }
  };

  const handleClose = () => {
    setOpenAdd(false);
  };

  const handleSave = () => {
    addMutation.mutate(formData);
  };

  const fetchScans = async (segmentId) => {
    const res = await axios.get(`/api/v1/segments/${segmentId}/scans`);
    return res.data.scans;
  };

  const toggleScans = async (id) => {
    const isExpanded = !!expandedScans[id];
    setExpandedScans(prev => ({ ...prev, [id]: !isExpanded }));

    if (!isExpanded) {
      const scans = await fetchScans(id);
      queryClient.setQueryData(['scans', id], scans);
    }
  };

  const segments = segmentsData?.segments || [];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">Network Segments</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenAdd(true)}>
          Add Segment
        </Button>
      </Box>

      {isLoading ? (
        <CircularProgress />
      ) : (
        <Grid container spacing={3}>
          {segments.map(seg => (
            <Grid item xs={12} md={6} lg={4} key={seg.id}>
              <Card sx={{ p: 3, borderTop: `4px solid ${seg.color || '#3b82f6'}` }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box>
                    <Typography variant="h6" fontWeight="bold">{seg.name}</Typography>
                    <Typography variant="body2" color="text.secondary" fontFamily="monospace">
                      {seg.cidr}
                    </Typography>
                  </Box>
                  <Button
                    color="error"
                    size="small"
                    onClick={() => {
                      if (window.confirm('Delete this segment?')) deleteMutation.mutate(seg.id);
                    }}
                  >
                    Delete
                  </Button>
                </Box>

                <Typography variant="body2" sx={{ mb: 3 }}>
                  {seg.description || 'No description provided.'}
                </Typography>

                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                  <Typography variant="body2" color="text.secondary">Configured Devices</Typography>
                  <Typography variant="body2" fontWeight="bold">{seg.device_count}</Typography>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3 }}>
                  <Typography variant="body2" color="text.secondary">Online Devices</Typography>
                  <Typography variant="body2" fontWeight="bold" color="success.main">{seg.devices_up}</Typography>
                </Box>

                {scanProgress[seg.id] && (
                  <Box sx={{ mb: 2 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption">Scanning {scanProgress[seg.id].current_ip}...</Typography>
                      <Typography variant="caption">{scanProgress[seg.id].scanned} / {scanProgress[seg.id].total}</Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={(scanProgress[seg.id].scanned / scanProgress[seg.id].total) * 100}
                    />
                  </Box>
                )}

                <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                  <Button
                    variant="outlined"
                    fullWidth
                    startIcon={<ScanIcon />}
                    disabled={!!scanProgress[seg.id]}
                    onClick={() => handleScan(seg.id)}
                  >
                    {scanProgress[seg.id] ? 'Scanning...' : 'Scan Now'}
                  </Button>
                </Box>

                <Accordion expanded={!!expandedScans[seg.id]} onChange={() => toggleScans(seg.id)} sx={{ bgcolor: 'rgba(255,255,255,0.03)', boxShadow: 'none' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2">Recent Scans</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 1, maxHeight: 200, overflowY: 'auto' }}>
                    {(() => {
                      const scans = queryClient.getQueryData(['scans', seg.id]) || [];
                      if (scans.length === 0) return <Typography variant="caption" color="text.secondary">No scans yet.</Typography>;

                      return scans.map(s => (
                        <Box key={s.id} sx={{ p: 1, mb: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
                          <Typography variant="caption" display="block">
                            {new Date(s.scanned_at).toLocaleString()}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
                            <Chip size="small" label={`Found ${s.hosts_found}`} />
                            <Chip size="small" color="success" label={`Up ${s.hosts_up}`} />
                          </Box>
                        </Box>
                      ));
                    })()}
                  </AccordionDetails>
                </Accordion>

              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <Dialog open={openAdd} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Add Network Segment</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth label="Segment Name" margin="dense" required
            value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
          />
          <TextField
            fullWidth label="CIDR (e.g. 192.168.1.0/24)" margin="dense" required
            value={formData.cidr} onChange={e => setFormData({ ...formData, cidr: e.target.value })}
            helperText="Defines the IP range for scanning"
          />
          <TextField
            fullWidth label="Description" margin="dense" multiline rows={2}
            value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })}
          />
          <Box sx={{ mt: 2 }}>
            <Typography variant="caption" display="block" mb={1}>Badge Color</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              {['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map(c => (
                <Box
                  key={c}
                  onClick={() => setFormData({ ...formData, color: c })}
                  sx={{
                    width: 24, height: 24, borderRadius: '50%', bgcolor: c,
                    cursor: 'pointer',
                    border: formData.color === c ? '2px solid white' : 'none'
                  }}
                />
              ))}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!formData.name || !formData.cidr}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
