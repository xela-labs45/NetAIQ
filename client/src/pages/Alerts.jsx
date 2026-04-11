import React, { useState } from 'react';
import { Box, Typography, Button, TextField, Chip, FormControlLabel, Switch } from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
  Check as CheckIcon, DoneAll as CheckAllIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

export default function Alerts() {
  const queryClient = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['alerts', unreadOnly],
    queryFn: () => axios.get(`/api/v1/alerts?unread=${unreadOnly}`).then(res => res.data),
    refetchInterval: 10000
  });

  const markReadMutation = useMutation({
    mutationFn: (id) => axios.put(`/api/v1/alerts/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries(['alerts'])
  });

  const markAllReadMutation = useMutation({
    mutationFn: () => axios.put('/api/v1/alerts/read-all'),
    onSuccess: () => queryClient.invalidateQueries(['alerts'])
  });

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'error';
      case 'warning': return 'warning';
      default: return 'info';
    }
  };

  const columns = [
    {
      field: 'severity',
      headerName: 'Severity',
      width: 120,
      renderCell: (params) => (
        <Chip
          label={params.value}
          color={getSeverityColor(params.value)}
          size="small"
          sx={{ width: 80, textTransform: 'capitalize' }}
        />
      )
    },
    {
      field: 'hostname',
      headerName: 'Device',
      width: 200,
      renderCell: (params) => params.row.hostname || params.row.ip_address || 'Unknown'
    },
    { field: 'message', headerName: 'Message', flex: 1 },
    {
      field: 'created_at',
      headerName: 'Time',
      width: 200,
      renderCell: (params) => new Date(params.value).toLocaleString('en-GB', { hour12: false }).replace(/\//g, '-').replace(',', '')
    },
    {
      field: 'is_read',
      headerName: 'Read',
      width: 100,
      renderCell: (params) => params.value ? <CheckIcon color="success" /> : '-'
    },
    {
      field: 'email_sent',
      headerName: 'Email Sent',
      width: 100,
      renderCell: (params) => params.value ? <CheckIcon color="success" /> : '-'
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      renderCell: (params) => !params.row.is_read && (
        <Button
          size="small"
          onClick={() => markReadMutation.mutate(params.row.id)}
        >
          Mark Read
        </Button>
      )
    }
  ];

  const alerts = alertsData?.alerts || [];

  return (
    <Box sx={{ height: 'calc(100vh - 100px)', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight="bold">Alerts History</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <FormControlLabel
            control={
              <Switch checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
            }
            label="Unread Only"
          />
          <Button
            variant="outlined"
            startIcon={<CheckAllIcon />}
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            Mark All Read
          </Button>
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, bgcolor: 'background.paper', borderRadius: 1 }}>
        <DataGrid
          rows={alerts}
          columns={columns}
          initialState={{
            pagination: { paginationModel: { pageSize: 50 } },
            sorting: { sortModel: [{ field: 'created_at', sort: 'desc' }] }
          }}
          pageSizeOptions={[25, 50, 100]}
          disableRowSelectionOnClick
          loading={isLoading}
          sx={{
            border: 'none',
            '& .MuiDataGrid-row': {
              bgcolor: (theme) => 'inherit'
            },
            // Style unread rows with a slight blue highlight
            '& .MuiDataGrid-row[data-rowindex]': {
              '&:not(:hover)': {
                backgroundColor: 'inherit'
              }
            }
          }}
          getRowClassName={(params) => params.row.is_read === 0 ? 'unread-row' : ''}
        />
        <style>{`
            .unread-row {
                background-color: rgba(59, 130, 246, 0.05) !important;
                font-weight: bold;
            }
        `}</style>
      </Box>
    </Box>
  );
}
