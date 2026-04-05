import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Grid, Card, LinearProgress, Accordion,
  AccordionSummary, AccordionDetails, Chip, CircularProgress, Tooltip,
  Alert
} from '@mui/material';
import {
  Add as AddIcon, ExpandMore as ExpandMoreIcon,
  WifiTethering as ScanIcon, Delete as DeleteIcon,
  Fingerprint as ArpIcon, CloudSync as CloudSyncIcon,
  InfoOutlined as InfoIcon, WarningAmber as WarningIcon
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
  const [localScans, setLocalScans] = useState({});

  // ARP Discovery state
  const [arpProgress, setArpProgress] = useState(null); // { stage, cidr, status, macs_found }
  const [unifiSyncing, setUnifiSyncing] = useState(false);

  // Fetch discovery capability to determine what to show
  const { data: capability } = useQuery({
    queryKey: ['discoveryCapability'],
    queryFn: () => axios.get('/api/v1/discovery/capability').then(res => res.data),
    staleTime: 5 * 60 * 1000 // match backend cache
  });

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
        if (expandedScans[data.segment_id]) {
          fetchScans(data.segment_id).then(scans => {
            setLocalScans(prev => ({ ...prev, [data.segment_id]: scans }));
          });
        }
      };

      const handleArpStarted = (data) => {
        setArpProgress({ status: 'running', stage: 'started', cidr: data.cidr, segment: data.segment, segment_id: data.segment_id });
      };

      const handleArpProgressUpdate = (data) => {
        setArpProgress(prev => prev ? { ...prev, stage: data.stage } : null);
      };

      const handleArpComplete = (data) => {
        setArpProgress({ status: 'complete', cidr: data.cidr, segment: data.segment, segment_id: data.segment_id, macs_found: data.macs_found });
        // Auto-clear after 10s
        setTimeout(() => { setArpProgress(null); }, 10000);
      };

      socket.on('scan:progress', handleProgress);
      socket.on('scan:complete', handleComplete);
      socket.on('discovery:arp_started', handleArpStarted);
      socket.on('discovery:arp_progress', handleArpProgressUpdate);
      socket.on('discovery:arp_complete', handleArpComplete);

      return () => {
        socket.off('scan:progress', handleProgress);
        socket.off('scan:complete', handleComplete);
        socket.off('discovery:arp_started', handleArpStarted);
        socket.off('discovery:arp_progress', handleArpProgressUpdate);
        socket.off('discovery:arp_complete', handleArpComplete);
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
      setFormData({ name: '', cidr: '', description: '', color: '#3b82f6' });
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

  // ARP scan — always targets the auto-detected L2 segment
  const handleArpScan = async () => {
    try {
      await axios.post('/api/v1/discovery/arp-scan');
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to start ARP discovery');
    }
  };

  // Manual UniFi harvest
  const handleUnifiSync = async () => {
    try {
      setUnifiSyncing(true);
      const res = await axios.post('/api/v1/discovery/harvest-unifi');
      const data = res.data;
      alert(`UniFi Sync complete: ${data.wifi || 0} WiFi, ${data.wired || 0} wired, ${data.historical || 0} historical`);
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to sync UniFi clients');
    } finally {
      setUnifiSyncing(false);
    }
  };

  const handleOpenAdd = () => {
    setFormData({ name: '', cidr: '', description: '', color: '#3b82f6' });
    setOpenAdd(true);
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
      setLocalScans(prev => ({ ...prev, [id]: scans }));
    }
  };

  const segments = segmentsData?.segments || [];
  const l2SegmentId = capability?.l2_segment?.segment_id;

  // Helper: check if a given segment is the server's L2 segment
  const isL2Segment = (segId) => l2SegmentId != null && segId === l2SegmentId;

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">Network Segments</Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {capability?.can_unifi_harvest && (
            <Tooltip title="Fetch all WiFi clients and historically seen devices from UniFi API">
              <Button
                variant="outlined"
                color="primary"
                startIcon={<CloudSyncIcon />}
                onClick={handleUnifiSync}
                disabled={unifiSyncing}
              >
                {unifiSyncing ? 'Syncing...' : 'Sync UniFi'}
              </Button>
            </Tooltip>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={handleOpenAdd}>
            Add Segment
          </Button>
        </Box>
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
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="h6" fontWeight="bold">{seg.name}</Typography>
                      {isL2Segment(seg.id) && (
                        <Chip
                          size="small"
                          label="L2"
                          sx={{ bgcolor: 'rgba(139, 92, 246, 0.15)', color: '#a78bfa', fontWeight: 600, fontSize: '0.65rem', height: 20 }}
                        />
                      )}
                    </Box>
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

                {/* ICMP Scan progress */}
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

                {/* ARP scan progress — only on the L2 segment card */}
                {isL2Segment(seg.id) && arpProgress && (
                  <Box sx={{ mb: 2, p: 1, bgcolor: 'rgba(156, 39, 176, 0.05)', borderRadius: 1, border: '1px solid rgba(156, 39, 176, 0.2)' }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" color="secondary">
                        {arpProgress.status === 'running'
                          ? `ARP Discovery (${arpProgress.stage === 'nmap_running' ? 'nmap scanning...' : arpProgress.stage === 'ip_neigh' ? 'reading ARP cache...' : 'scanning...'})`
                          : `${arpProgress.macs_found} devices discovered`
                        }
                      </Typography>
                    </Box>
                    <LinearProgress
                      color="secondary"
                      variant={arpProgress.status === 'running' ? 'indeterminate' : 'determinate'}
                      value={arpProgress.status === 'complete' ? 100 : 0}
                    />
                  </Box>
                )}

                <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                  {/* ICMP Scan button — always available */}
                  <Button
                    variant="outlined"
                    fullWidth
                    startIcon={<ScanIcon />}
                    disabled={!!scanProgress[seg.id]}
                    onClick={() => handleScan(seg.id)}
                  >
                    {scanProgress[seg.id] ? 'Scanning...' : 'Scan Now'}
                  </Button>

                  {/* ARP Discover MACs button — only on the L2 segment */}
                  {isL2Segment(seg.id) && (
                    capability?.can_arp_scan ? (
                      <Tooltip title="ARP scan to discover MAC addresses of wired devices on this segment">
                        <Button
                          variant="outlined"
                          color="secondary"
                          fullWidth
                          startIcon={<ArpIcon />}
                          disabled={arpProgress?.status === 'running'}
                          onClick={handleArpScan}
                        >
                          {arpProgress?.status === 'running' ? 'Discovering...' : 'Discover MACs'}
                        </Button>
                      </Tooltip>
                    ) : (
                      <Tooltip title={capability?.platform_note || 'ARP scanning not available'}>
                        <Chip
                          icon={<WarningIcon />}
                          label="ARP unavailable"
                          color="warning"
                          variant="outlined"
                          sx={{ height: 36, flex: 1 }}
                        />
                      </Tooltip>
                    )
                  )}

                  {/* Non-L2 segments: info chip */}
                  {!isL2Segment(seg.id) && (
                    <Tooltip title="This segment is on a different Layer 2 network from the NetMon server. Wired device MACs cannot be discovered via ARP across network boundaries. WiFi device MACs are available through the UniFi API.">
                      <Chip
                        icon={<InfoIcon />}
                        label="WiFi MACs via UniFi"
                        variant="outlined"
                        sx={{ height: 36, flex: 1, color: 'text.secondary', borderColor: 'divider' }}
                      />
                    </Tooltip>
                  )}
                </Box>

                {isL2Segment(seg.id) && capability?.can_arp_scan && (
                  <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 2, textAlign: 'center', fontSize: '0.65rem' }}>
                    ARP scan sends traffic to all IPs. Use manually — not for scheduling.
                  </Typography>
                )}

                <Accordion expanded={!!expandedScans[seg.id]} onChange={() => toggleScans(seg.id)} sx={{ bgcolor: 'rgba(255,255,255,0.03)', boxShadow: 'none' }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="body2">Recent Scans</Typography>
                  </AccordionSummary>
                  <AccordionDetails sx={{ p: 1, maxHeight: 200, overflowY: 'auto' }}>
                    {(() => {
                      const scans = localScans[seg.id] || [];
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
