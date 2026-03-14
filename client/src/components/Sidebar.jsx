import React, { useEffect, useState } from 'react';
import {
    Box, Drawer, List, ListItem, ListItemButton,
    ListItemIcon, ListItemText, Typography,
    Divider, Tooltip, Badge, IconButton
} from '@mui/material';
import {
    Home as HomeIcon,
    Computer as ComputerIcon,
    Lan as LanIcon,
    BarChart as BarChartIcon,
    NotificationsOutlined as NotificationsIcon,
    Settings as SettingsIcon,
    Logout as LogoutIcon,
    Speed as SpeedIcon,
    Menu as MenuIcon,
    MenuOpen as MenuOpenIcon
} from '@mui/icons-material';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSocket } from '../hooks/useSocket';
import axios from 'axios';

const SIDEBAR_EXPANDED = 240;
const SIDEBAR_COLLAPSED = 64;

export default function Sidebar({ open, toggle }) {
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
            const handleNew = () => setUnreadCount(prev => prev + 1);

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

    const transitionStyles = {
        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
    };

    const textTransitionStyles = {
        opacity: open ? 1 : 0,
        width: open ? 'auto' : 0,
        overflow: 'hidden',
        transition: 'opacity 0.15s ease' + (open ? ' 0.05s' : ''),
        whiteSpace: 'nowrap'
    };

    return (
        <Drawer
            variant="permanent"
            sx={{
                width: open ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
                flexShrink: 0,
                whiteSpace: 'nowrap',
                ...transitionStyles,
                [`& .MuiDrawer-paper`]: {
                    width: open ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED,
                    boxSizing: 'border-box',
                    overflowX: 'hidden',
                    ...transitionStyles,
                },
            }}
        >
            {/* Hamburger Toggle */}
            <IconButton
                onClick={toggle}
                sx={{
                    width: 40,
                    height: 40,
                    margin: '12px auto 8px',
                    display: 'flex',
                    borderRadius: 1,
                    color: 'text.secondary',
                    '&:hover': {
                        backgroundColor: 'rgba(255,255,255,0.08)',
                        color: 'text.primary'
                    }
                }}
            >
                {open ? <MenuOpenIcon /> : <MenuIcon />}
            </IconButton>

            {/* Brand Logo Area */}
            <Box sx={{ p: 2, pt: 1, display: 'flex', alignItems: 'center', gap: 1, justifyContent: open ? 'flex-start' : 'center' }}>
                <SpeedIcon color="primary" sx={{ fontSize: 32, flexShrink: 0 }} />
                <Typography
                    variant="h6"
                    component="div"
                    sx={{
                        fontWeight: 'bold',
                        opacity: open ? 1 : 0,
                        width: open ? 'auto' : 0,
                        overflow: 'hidden',
                        transition: 'opacity 0.2s ease, width 0.25s ease',
                        whiteSpace: 'nowrap'
                    }}
                >
                    NetMon
                </Typography>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)', my: 1 }} />

            <Box sx={{ overflowY: 'auto', overflowX: 'hidden', flexGrow: 1 }}>
                <List sx={{ px: 0 }}>
                    {menuItems.map((item) => (
                        <ListItem key={item.text} disablePadding sx={{ display: 'block' }}>
                            <Tooltip title={open ? '' : item.text} placement="right" arrow>
                                <ListItemButton
                                    selected={location.pathname === item.path}
                                    onClick={() => navigate(item.path)}
                                    sx={{
                                        mx: open ? 1 : 0.5,
                                        borderRadius: 1,
                                        mb: 0.5,
                                        px: 2.5,
                                        justifyContent: open ? 'initial' : 'center',
                                        '&.Mui-selected': {
                                            backgroundColor: 'rgba(59, 130, 246, 0.15)',
                                            borderLeft: open ? '3px solid #3b82f6' : 'none',
                                        }
                                    }}
                                >
                                    <ListItemIcon
                                        sx={{
                                            minWidth: 0,
                                            mr: open ? 2 : 'auto',
                                            justifyContent: 'center',
                                            color: location.pathname === item.path ? 'primary.main' : 'inherit',
                                            transition: 'margin 0.25s ease'
                                        }}
                                    >
                                        {item.icon}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={item.text}
                                        sx={textTransitionStyles}
                                    />
                                </ListItemButton>
                            </Tooltip>
                        </ListItem>
                    ))}
                </List>
            </Box>

            <Divider sx={{ borderColor: 'rgba(255,255,255,0.08)' }} />

            <Box sx={{ p: open ? 2 : 1, transition: 'padding 0.25s ease' }}>
                <Typography
                    variant="body2"
                    color="text.secondary"
                    noWrap
                    sx={{
                        mb: 1,
                        opacity: open ? 1 : 0,
                        width: open ? 'auto' : 0,
                        overflow: 'hidden',
                        transition: 'opacity 0.15s ease'
                    }}
                >
                    {user?.email}
                </Typography>
                <List disablePadding>
                    <ListItem disablePadding sx={{ display: 'block' }}>
                        <Tooltip title={open ? '' : 'Logout'} placement="right" arrow>
                            <ListItemButton
                                onClick={logout}
                                sx={{
                                    mx: 0,
                                    borderRadius: 1,
                                    color: 'error.main',
                                    justifyContent: open ? 'initial' : 'center',
                                    px: 2.5
                                }}
                            >
                                <ListItemIcon
                                    sx={{
                                        minWidth: 0,
                                        mr: open ? 2 : 'auto',
                                        justifyContent: 'center',
                                        color: 'inherit',
                                        transition: 'margin 0.25s ease'
                                    }}
                                >
                                    <LogoutIcon />
                                </ListItemIcon>
                                <ListItemText
                                    primary="Logout"
                                    sx={{
                                        opacity: open ? 1 : 0,
                                        width: open ? 'auto' : 0,
                                        overflow: 'hidden',
                                        transition: 'opacity 0.15s ease, width 0.25s ease'
                                    }}
                                />
                            </ListItemButton>
                        </Tooltip>
                    </ListItem>
                </List>
            </Box>
        </Drawer>
    );
}
