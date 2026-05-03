import React, { useState, useEffect } from 'react';
import { Box, Snackbar, Alert } from '@mui/material';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import { useSocket } from '../hooks/useSocket';

export default function Layout() {
    const socket = useSocket();
    const [toast, setToast] = useState({ open: false, message: '', severity: 'info' });

    const SIDEBAR_EXPANDED = 240;
    const SIDEBAR_COLLAPSED = 64;

    const [sidebarOpen, setSidebarOpen] = useState(() => {
        const saved = localStorage.getItem('sidebar_open');
        return saved !== null ? saved === 'true' : false;
    });

    const toggleSidebar = () => {
        setSidebarOpen(prev => {
            const newState = !prev;
            localStorage.setItem('sidebar_open', String(newState));
            return newState;
        });
    };

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
            <Sidebar open={sidebarOpen} toggle={toggleSidebar} />
            <Box
                component="main"
                sx={{
                    flexGrow: 1,
                    p: 3,
                    backgroundColor: 'background.default',
                    overflow: 'auto',
                    marginLeft: 0,
                    width: '100%',
                    transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                }}
            >
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
