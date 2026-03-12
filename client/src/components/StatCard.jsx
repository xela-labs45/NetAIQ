import React from 'react';
import { Box, Card, Typography } from '@mui/material';

export default function StatCard({ title, value, color, icon, urgent }) {
  return (
    <Card
      sx={{
        p: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        borderLeft: `4px solid ${color}`,
        backgroundColor: urgent ? 'rgba(239, 68, 68, 0.1)' : undefined,
        height: '100%'
      }}
    >
      <Box>
        <Typography color="text.secondary" variant="overline" display="block" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div" sx={{ color: urgent ? 'error.main' : 'text.primary', fontWeight: 'bold' }}>
          {value}
        </Typography>
      </Box>
      <Box sx={{
        backgroundColor: `${color}22`,
        p: 1,
        borderRadius: '50%',
        display: 'flex',
        color: color
      }}>
        {icon}
      </Box>
    </Card>
  );
}
