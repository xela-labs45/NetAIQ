import React from 'react';
import { Box, Card, Typography } from '@mui/material';

import { Skeleton } from '@mui/material';

export default function StatCard({ title, value, color, icon, urgent, subtitle, onClick, hoverColor, extraAction, loading }) {
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
      <Box sx={{ zIndex: 1 }}>
        <Typography color="text.secondary" variant="overline" display="block" gutterBottom>
          {title}
        </Typography>
        <Typography variant="h4" component="div" sx={{ color: urgent ? 'error.main' : 'text.primary', fontWeight: 'bold' }}>
          {loading ? <Skeleton width={60} /> : value}
        </Typography>
        {(subtitle || loading) && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
            {loading ? <Skeleton width={100} height={16} /> : subtitle}
          </Typography>
        )}
        {extraAction && (
          <Box
            component="a"
            onClick={(e) => { e.stopPropagation(); extraAction.onClick(); }}
            sx={{
              mt: 1,
              display: 'block',
              fontSize: '0.7rem',
              color: color,
              textDecoration: 'none',
              fontWeight: 'bold',
              '&:hover': { textDecoration: 'underline' },
              cursor: 'pointer',
              zIndex: 2,
              position: 'relative'
            }}
          >
            {extraAction.label}
          </Box>
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
