import React, { useState } from 'react';
import { Box, Typography, Grid, Card, CircularProgress, Alert, ToggleButton, ToggleButtonGroup, Paper } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import {
  WifiTetheringOutlined as APTetheringIcon,
  WifiOutlined as WifiUserIcon,
  CheckCircleOutlined as CheckCircleIcon,
  WarningAmber as WarningIcon,
  Download as DownloadIcon,
  Upload as UploadIcon
} from '@mui/icons-material';
import { Skeleton, Chip } from '@mui/material';

export default function Bandwidth() {

  const [timeRange, setTimeRange] = useState('today'); // 'today', '24h', '7d'

  const { data: wlanData, isLoading: wlanLoading, isError: wlanError } = useQuery({
    queryKey: ['unifi', 'wlan'],
    queryFn: () => axios.get('/api/v1/unifi/wlan').then(res => res.data),
    refetchInterval: 60000,
    retry: 1
  });

  const { data: clientsUsageData, isLoading: clientsLoading, isError: clientsError } = useQuery({
    queryKey: ['unifi', 'clients-usage', timeRange],
    queryFn: () => {
      const { start, end } = getTimeRange(timeRange);
      return axios.get(`/api/v1/unifi/clients-usage?start=${start}&end=${end}`).then(res => res.data);
    },
    refetchInterval: 60000,
    retry: 1
  });


  function getTimeRange(range) {
    const now = Date.now();
    switch (range) {
      case 'today':
        return { start: new Date().setHours(0, 0, 0, 0), end: now };
      case '24h':
        return { start: now - 86400000, end: now };
      case '7days':
      case '7d':
        return { start: now - 604800000, end: now };
      default:
        return { start: new Date().setHours(0, 0, 0, 0), end: now };
    }
  }

  const formatBytes = (bytes, decimals = 2) => {
    if (bytes == null || isNaN(bytes) || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0) return '0 Bytes';
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const getTopClients = () => {
    const rawClients = clientsUsageData?.data;
    if (!Array.isArray(rawClients)) return [];

    return [...rawClients]
      .map(c => {
        if (!c) return null;
        let name = c.name || c.mac || 'Unknown';
        let originalName = name;

        // Label resolution logic
        if (name.match(/^([0-9a-f]{2}[:-]){5}([0-9a-f]{2})$/i)) {
          // It's a MAC address, shorten it
          name = `..:${name.slice(-8)}`;
        }

        let truncatedName = name.length > 18 ? name.slice(0, 16) + '…' : name;

        return {
          originalName: originalName,
          name: truncatedName,
          isMac: name.startsWith('..:'),
          mac: c.mac || 'N/A',
          ip: c.ip || 'N/A',
          totalRate: (c.tx_bytes || 0) + (c.rx_bytes || 0),
          tx: c.tx_bytes || 0,
          rx: c.rx_bytes || 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => (b.totalRate || 0) - (a.totalRate || 0))
      .slice(0, 15);
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <Paper sx={{ p: 2, bgcolor: '#1e293b', color: '#fff', border: '1px solid #3b82f6' }}>
          <Typography variant="subtitle2" fontWeight="bold" gutterBottom>{data.originalName}</Typography>
          <Typography variant="body2" color="text.secondary">IP: {data.ip}</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>MAC: {data.mac}</Typography>
          <Typography variant="body2" sx={{ color: '#8b5cf6' }}>Upload (RX): {formatBytes(data.rx)}</Typography>
          <Typography variant="body2" sx={{ color: '#3b82f6' }}>Download (TX): {formatBytes(data.tx)}</Typography>
        </Paper>
      );
    }
    return null;
  };


  const wlan = wlanData;

  if (wlanLoading || clientsLoading) {
    return <BandwidthSkeleton />;
  }

  if (wlanError || clientsError) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>Bandwidth Monitoring</Typography>
        <Alert severity="error" sx={{ mt: 2 }}>
          Failed to load network bandwidth data. Please verify your UniFi controller settings and connection status.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>Bandwidth Monitoring</Typography>

      {/* WiFi Summary */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', right: -20, bottom: -20, opacity: 0.1 }}>
              <APTetheringIcon sx={{ fontSize: 180 }} />
            </Box>
            <Typography variant="h6" gutterBottom>WiFi Overview</Typography>
            {wlanLoading ? <CircularProgress /> : wlan ? (
              <Box sx={{ zIndex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Chip
                    label={
                      wlan.status === 'ok' ? 'HEALTHY' :
                        wlan.status === 'warning' ? 'WARNING' :
                          wlan.status === 'unavailable' ? 'UNAVAILABLE' : 'UNKNOWN'
                    }
                    color={wlan.status === 'ok' ? 'success' : wlan.status === 'warning' ? 'warning' : 'default'}
                    size="small"
                    sx={{ fontWeight: 'bold' }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                    {wlan.num_user} active users
                  </Typography>
                </Box>

                <Typography variant="body2" color="text.secondary" gutterBottom sx={{ mt: 2 }}>
                  <DownloadIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', mr: 0.5 }} />
                  {wlan.tx_mbps} Mbps (Download)
                  <UploadIcon sx={{ fontSize: 16, verticalAlign: 'text-bottom', ml: 1, mr: 0.5 }} />
                  {wlan.rx_mbps} Mbps (Upload)
                </Typography>

                <Typography variant="body2" color="text.secondary" gutterBottom>
                  {wlan.num_adopted} / {wlan.num_ap} APs adopted
                </Typography>

                <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                  {wlan.num_disconnected > 0 ? (
                    <>
                      <WarningIcon color="error" sx={{ fontSize: 18 }} />
                      <Typography variant="body2" color="error.main" fontWeight="bold">
                        {wlan.num_disconnected} AP(s) offline
                      </Typography>
                    </>
                  ) : (
                    <>
                      <CheckCircleIcon color="success" sx={{ fontSize: 18 }} />
                      <Typography variant="body2" color="success.main" fontWeight="bold">
                        All APs operational
                      </Typography>
                    </>
                  )}
                </Box>
              </Box>
            ) : (
              <Typography color="text.secondary">No WiFi data available.</Typography>
            )}
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card sx={{ p: 3, minHeight: 400 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="h6">Top Clients by Usage</Typography>
                {clientsUsageData?.source === 'realtime' && (
                  <Chip
                    label="Live data · historical report unavailable"
                    size="small"
                    color="warning"
                    variant="outlined"
                    sx={{ fontSize: '0.7rem' }}
                  />
                )}
              </Box>
              <ToggleButtonGroup
                color="primary"
                value={timeRange}
                exclusive
                onChange={(e, val) => val && setTimeRange(val)}
                size="small"
              >
                <ToggleButton value="today">Today</ToggleButton>
                <ToggleButton value="24h">24h</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getTopClients()} layout="vertical" margin={{ top: 5, right: 30, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(tick) => formatBytes(tick)} stroke="#888" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={160}
                    interval={0}
                    tick={(props) => {
                      const { x, y, payload } = props;
                      const data = getTopClients().find(d => d.name === payload.value);
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text
                            x={-10}
                            y={0}
                            dy={4}
                            textAnchor="end"
                            fill={data?.isMac ? "#888" : "#ccc"}
                            fontSize={11}
                            fontStyle={data?.isMac ? "italic" : "normal"}
                          >
                            {payload.value}
                          </text>
                        </g>
                      );
                    }}
                    stroke="#888"
                  />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="tx" name="Download (TX)" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="rx" name="Upload (RX)" stackId="a" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>
      </Grid>

    </Box>
  );
}

function BandwidthSkeleton() {
  return (
    <Box sx={{ p: 0 }}>
      <Skeleton variant="text" width={400} height={60} sx={{ mb: 4 }} />
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12}>
          <Skeleton variant="rectangular" height={220} sx={{ borderRadius: 2 }} />
        </Grid>
      </Grid>
      <Skeleton variant="rectangular" height={400} sx={{ borderRadius: 2 }} />
    </Box>
  );
}
