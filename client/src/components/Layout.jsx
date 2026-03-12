import React, { useState, useEffect } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSocket } from '../hooks/useSocket';

export default function Layout() {
    const socket = useSocket();
    const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });

    useEffect(() => {
        if (socket) {
            const handleNewAlert = (data) => {
                setToast({
                    open: true,
                    message: data.alert.message,
                    severity: data.alert.severity === 'critical' ? 'error' :
                        data.alert.severity === 'warning' ? 'warning' : 'info'
                });
            };

            socket.on('alert:new', handleNewAlert);

            return () => {
                socket.off('alert:new', handleNewAlert);
            };
        }
    }, [socket]);

    const handleClose = (event, reason) => {
        if (reason === 'clickaway') return;
        setToast(prev => ({ ...prev, open: false }));
    };

    return (
        <Box sx={{ display: 'flex', minHeight: '100vh' }}>
            <Sidebar />
            <Box component="main" sx={{ flexGrow: 1, p: 3, backgroundColor: 'background.default', overflow: 'auto' }}>
                <Outlet />
            </Box>

            {/* Global Toast for Alerts */}
            <Snackbar
                open={toast.open}
                autoHideDuration={6000}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            >
                <Alert onClose={handleClose} severity={toast.severity} sx={{ width: '100%' }}>
                    {toast.message}
                </Alert>
            </Snackbar>
        </Box>
    );
}
