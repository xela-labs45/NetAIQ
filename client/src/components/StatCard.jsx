import React from 'react';
import { Box, Card, Typography } from '@mui/material';

export default function StatCard({ title, value, color, icon, urgent, subtitle, onClick, hoverColor }) {
  return (
    <Card
      onClick={onClick}
      sx={{
        p: 2,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        border: '1px solid transparent',
        borderLeft: `4px solid ${color}`,
        backgroundColor: urgent ? 'rgba(239, 68, 68, 0.1)' : undefined,
        height: '100%',
        position: 'relative',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.2s',
        '&:hover': hoverColor ? {
          borderColor: hoverColor
        } : {}
      }}
    >
      <Box>
        <Typography color="text.secondary" variant="overline" display="block" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div" sx={{ color: urgent ? 'error.main' : 'text.primary', fontWeight: 'bold' }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" color="text.secondary">{subtitle}</Typography>
        )}
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
      {onClick && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ position: 'absolute', bottom: 8, right: 16, fontSize: '11px' }}
        >
          View devices →
        </Typography>
      )}
    </Card>
  );
}
