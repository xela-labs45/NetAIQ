import React, { useState } from 'react';
import { Box, Typography, Grid, Card, CircularProgress, Alert, ToggleButton, ToggleButtonGroup, Paper } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { Router as RouterIcon } from '@mui/icons-material';

export default function Bandwidth() {

  const [timeRange, setTimeRange] = useState('today'); // 'today', '24h', '7d'

  const { data: wanData, isLoading: wanLoading, error: wanError } = useQuery({
    queryKey: ['unifi', 'wan'],
    queryFn: () => axios.get('/api/v1/unifi/wan').then(res => res.data),
    refetchInterval: 60000
  });

  const { data: clientsUsageData } = useQuery({
    queryKey: ['unifi', 'clients-usage', timeRange],
    queryFn: () => {
      let start, end = Date.now();
      if (timeRange === 'today') {
        start = new Date().setHours(0, 0, 0, 0);
      } else if (timeRange === '24h') {
        start = end - 86400000;
      } else if (timeRange === '7d') {
        start = end - 604800000;
      }
      return axios.get(`/api/v1/unifi/clients-usage?start=${start}&end=${end}`).then(res => res.data);
    },
    refetchInterval: 60000
  });

  const { data: hourlyChart } = useQuery({
    queryKey: ['unifi', 'hourly'],
    queryFn: () => {
      const end = Date.now();
      const start = end - (24 * 60 * 60 * 1000); // 24 hours ago
      return axios.post('/api/v1/unifi/report/hourly-site', { start, end }).then(res => res.data);
    },
    refetchInterval: 300000 // 5m
  });

  const formatBytes = (bytes, decimals = 2) => {
    if (!+bytes) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  const getTopClients = () => {
    if (!clientsUsageData?.data) return [];
    return [...clientsUsageData.data]
      .map(c => {
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
          totalRate: c.tx_bytes + c.rx_bytes,
          tx: c.tx_bytes,
          rx: c.rx_bytes
        };
      })
      .sort((a, b) => b.totalRate - a.totalRate)
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
          <Typography variant="body2" sx={{ color: '#8b5cf6' }}>Upload: {formatBytes(data.tx)}</Typography>
          <Typography variant="body2" sx={{ color: '#3b82f6' }}>Download: {formatBytes(data.rx)}</Typography>
        </Paper>
      );
    }
    return null;
  };

  const formatHourlyData = () => {
    if (!hourlyChart?.data) return [];
    return hourlyChart.data.map(d => ({
      time: d.time,
      tx: d['wan-tx_bytes'] || 0,
      rx: d['wan-rx_bytes'] || 0
    }));
  };

  const wan = wanData?.stats;

  if (wanError) {
    return (
      <Box>
        <Typography variant="h4" fontWeight="bold" gutterBottom>Bandwidth</Typography>
        <Alert severity="warning">
          Failed to load UniFi data. Please check your settings and connectivity to the UniFi Controller.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h4" fontWeight="bold" gutterBottom>Bandwidth Monitoring</Typography>

      {/* WAN Summary */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} md={4}>
          <Card sx={{ p: 3, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative', overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', right: -20, bottom: -20, opacity: 0.1 }}>
              <RouterIcon sx={{ fontSize: 180 }} />
            </Box>
            <Typography variant="h6" gutterBottom>WAN Interface</Typography>
            {wanLoading ? <CircularProgress /> : wan ? (
              <Box sx={{ zIndex: 1 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Status: {
                    wan.status === 'up' ? (
                      <Chip label="ONLINE" color="success" size="small" sx={{ fontWeight: 'bold' }} />
                    ) : wan.status === 'down' ? (
                      <Chip label="OFFLINE" color="error" size="small" sx={{ fontWeight: 'bold' }} />
                    ) : (
                      <Chip label="UNKNOWN" color="default" size="small" sx={{ fontWeight: 'bold' }} />
                    )
                  }
                </Typography>

                {wan.status === 'unknown' ? (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    Could not read WAN data from UniFi
                  </Typography>
                ) : (
                  <>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      IP Address: <Typography component="span" color="text.primary">{wan.wan_ip || 'Unknown'}</Typography>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                      Latency: <Typography component="span" color="text.primary">{wan.latency ? `${wan.latency} ms` : '—'}</Typography>
                    </Typography>

                    <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                      <Box>
                        <Typography variant="caption" color="primary">Current Download</Typography>
                        <Typography variant="h5" fontWeight="bold">{formatBytes(wan.rx_mbps * 125000)}/s</Typography>
                      </Box>
                      <Box textAlign="right">
                        <Typography variant="caption" color="secondary">Current Upload</Typography>
                        <Typography variant="h5" fontWeight="bold">{formatBytes(wan.tx_mbps * 125000)}/s</Typography>
                      </Box>
                    </Box>
                  </>
                )}
              </Box>
            ) : (
              <Typography color="text.secondary">No WAN data available.</Typography>
            )}
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card sx={{ p: 3, height: '100%', minHeight: 300 }}>
            <Typography variant="h6" gutterBottom>WAN Traffic — Last 24h</Typography>
            <Box sx={{ height: 250, display: 'flex', flexDirection: 'column' }}>
              {formatHourlyData().length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={formatHourlyData()} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorTx" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                    <XAxis
                      dataKey="time"
                      tickFormatter={(tick) => format(new Date(tick), 'HH:mm')}
                      stroke="#888"
                    />
                    <YAxis
                      tickFormatter={(tick) => formatBytes(tick)}
                      stroke="#888"
                    />
                    <RechartsTooltip
                      labelFormatter={(label) => format(new Date(label), 'MMM dd, HH:mm')}
                      formatter={(value) => formatBytes(value)}
                      contentStyle={{ backgroundColor: '#111827', borderColor: '#3b82f6' }}
                    />
                    <Legend />
                    <Area type="monotone" name="Download (RX)" dataKey="rx" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRx)" />
                    <Area type="monotone" name="Upload (TX)" dataKey="tx" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorTx)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Alert severity="info" sx={{ bgcolor: 'rgba(59, 130, 246, 0.05)', border: '1px solid rgba(59, 130, 246, 0.2)' }}>
                    No WAN traffic data available. This may be a UniFi reporting configuration issue.
                  </Alert>
                </Box>
              )}
            </Box>
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
                <ToggleButton value="7d">7 Days</ToggleButton>
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
                  <Bar dataKey="rx" name="Download (RX)" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="tx" name="Upload (TX)" stackId="a" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </Box>
          </Card>
        </Grid>
      </Grid>

    </Box>
  );
}
