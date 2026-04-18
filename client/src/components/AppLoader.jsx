import React from 'react';
import { Box, Typography } from '@mui/material';
import Lottie from 'lottie-react';
import networkPulseAnimation from '../animations/networkPulse.json';

// Source: Custom synthesis
// License: Free for all uses
// No attribution required

export default function AppLoader({ appLoading }) {
  if (!appLoading) return null;

  return (
    <Box sx={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'background.default',
      zIndex: 9999
    }}>
      <Box sx={{ position: 'relative', width: 120, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Lottie 
            animationData={networkPulseAnimation}
            style={{ width: 120, height: 120 }}
            loop={true}
          />
          <Typography 
            variant="body2" 
            color="text.secondary"
            sx={{ position: 'absolute', top: '100%', mt: 2, whiteSpace: 'nowrap' }}
          >
            Loading network data...
          </Typography>
      </Box>
    </Box>
  );
}
