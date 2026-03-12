import React, { useState } from 'react';
import { Box, Typography, Grid, Card, CircularProgress, Alert } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';
import { Router as RouterIcon } from '@mui/icons-material';

export default function Bandwidth() {

  const { data: wanData, isLoading: wanLoading, error: wanError } = useQuery({
    queryKey: ['unifi', 'wan'],
    queryFn: () => axios.get('/api/v1/unifi/wan').then(res => res.data),
    refetchInterval: 60000
  });

  const { data: clientsData } = useQuery({
    queryKey: ['unifi', 'clients'],
    queryFn: () => axios.get('/api/v1/unifi/clients').then(res => res.data),
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
    if (!clientsData?.data) return [];
    return [...clientsData.data]
      .filter(c => c.tx_bytes > 0 || c.rx_bytes > 0)
      .map(c => ({
        name: c.hostname || c.name || c.mac,
        totalRate: c.tx_bytes + c.rx_bytes,
        tx: c.tx_bytes,
        rx: c.rx_bytes
      }))
      .sort((a, b) => b.totalRate - a.totalRate)
      .slice(0, 10);
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
                  Status: <Typography component="span" color={wan.status === 'ok' ? 'success.main' : 'error.main'} fontWeight="bold" textTransform="uppercase">{wan.status}</Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  IP Address: <Typography component="span" color="text.primary">{wan.wan_ip || 'Unknown'}</Typography>
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Latency: <Typography component="span" color="text.primary">{wan.latency} ms</Typography>
                </Typography>

                <Box sx={{ mt: 3, display: 'flex', justifyContent: 'space-between' }}>
                  <Box>
                    <Typography variant="caption" color="primary">Current Download</Typography>
                    <Typography variant="h5" fontWeight="bold">{formatBytes(wan.rx_bytes_r)}/s</Typography>
                  </Box>
                  <Box textAlign="right">
                    <Typography variant="caption" color="secondary">Current Upload</Typography>
                    <Typography variant="h5" fontWeight="bold">{formatBytes(wan.tx_bytes_r)}/s</Typography>
                  </Box>
                </Box>
              </Box>
            ) : (
              <Typography color="text.secondary">No WAN data available.</Typography>
            )}
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card sx={{ p: 3, height: '100%', minHeight: 300 }}>
            <Typography variant="h6" gutterBottom>WAN Traffic — Last 24h</Typography>
            <Box sx={{ height: 250 }}>
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
            </Box>
          </Card>
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Card sx={{ p: 3, minHeight: 400 }}>
            <Typography variant="h6" gutterBottom>Top Clients by Current Usage</Typography>
            <Box sx={{ height: 350 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={getTopClients()} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
                  <XAxis type="number" tickFormatter={(tick) => formatBytes(tick)} stroke="#888" />
                  <YAxis type="category" dataKey="name" width={150} stroke="#888" />
                  <RechartsTooltip
                    formatter={(value) => formatBytes(value)}
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#3b82f6' }}
                  />
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
