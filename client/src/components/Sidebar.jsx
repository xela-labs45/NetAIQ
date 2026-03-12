import React, { useEffect, useState } from 'react';
import {
    Box, Drawer, List, ListItem, ListItemButton,
    ListItemIcon, ListItemText, Typography,
    Divider, Tooltip, Badge
} from '@mui/material';
import {
    Home as HomeIcon,
    Computer as ComputerIcon,
    Lan as LanIcon,
    BarChart as BarChartIcon,
    Notifications as NotificationsIcon,
    Settings as SettingsIcon,
    Logout as LogoutIcon,
    Speed as SpeedIcon
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import axios from 'axios';

const drawerWidth = 240;

export default function Sidebar() {
    const location = useLocation();
    const navigate = useNavigate();
    const { logout, user } = useAuth();
    const socket = useSocket();
    const [unreadCount, setUnreadCount] = useState(0);

    useEffect(() => {
        // Initial fetch
        axios.get('/api/v1/alerts/count').then(res => {
            setUnreadCount(res.data.unread_count);
        }).catch(() => { });
    }, []);

    useEffect(() => {
        if (socket) {
            const handleCount = (data) => setUnreadCount(data.unread_count);
            const handleNew = () => setUnreadCount(prev => prev + 1); // fallback if count event misses

            socket.on('alert:count', handleCount);
            socket.on('alert:new', handleNew);

            return () => {
                socket.off('alert:count', handleCount);
                socket.off('alert:new', handleNew);
            };
        }
    }, [socket]);

    const menuItems = [
        { text: 'Dashboard', icon: <HomeIcon />, path: '/dashboard' },
        { text: 'Devices', icon: <ComputerIcon />, path: '/devices' },
        { text: 'Segments', icon: <LanIcon />, path: '/segments' },
        { text: 'Bandwidth', icon: <BarChartIcon />, path: '/bandwidth' },
        {
            text: 'Alerts',
            icon: (
                <Badge badgeContent={unreadCount} color="error" max={99}>
                    <NotificationsIcon />
                </Badge>
            ),
            path: '/alerts'
        },
        { text: 'Settings', icon: <SettingsIcon />, path: '/settings' },
    ];

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: drawerWidth,
                flexShrink: 0,
                [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
            }}
        >
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                <SpeedIcon color="primary" sx={{ fontSize: 32 }} />
                <Typography variant="h6" component="div" sx={{ fontWeight: 'bold' }}>
                    NetMon
                </Typography>
            </Box>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            <Box sx={{ overflow: 'auto', flexGrow: 1 }}>
                <List>
                    {menuItems.map((item) => (
                        <ListItem key={item.text} disablePadding>
                            <ListItemButton
                                selected={location.pathname === item.path}
                                onClick={() => navigate(item.path)}
                                sx={{
                                    mx: 1,
                                    borderRadius: 1,
                                    mb: 0.5,
                                    '&.Mui-selected': {
                                        backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                        borderLeft: '3px solid #3b82f6',
                                    }
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 40, color: location.pathname === item.path ? 'primary.main' : 'inherit' }}>
                                    {item.icon}
                                </ListItemIcon>
                                <ListItemText primary={item.text} />
                            </ListItemButton>
                        </ListItem>
                    ))}
                </List>
            </Box>
            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />
            <Box sx={{ p: 2 }}>
                <Typography variant="body2" color="text.secondary" noWrap sx={{ mb: 1 }}>
                    {user?.email}
                </Typography>
                <List disablePadding>
                    <ListItem disablePadding>
                        <ListItemButton
                            onClick={logout}
                            sx={{ mx: 0, borderRadius: 1, color: 'error.main' }}
                        >
                            <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>
                                <LogoutIcon />
                            </ListItemIcon>
                            <ListItemText primary="Logout" />
                        </ListItemButton>
                    </ListItem>
                </List>
            </Box>
        </Drawer>
    );
}
