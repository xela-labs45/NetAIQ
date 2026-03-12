import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#0a0f1e',
            paper: '#111827',
        },
        primary: {
            main: '#3b82f6',
        },
        success: {
            main: '#22c55e',
        },
        error: {
            main: '#ef4444',
        },
        warning: {
            main: '#f59e0b',
        },
        info: {
            main: '#2196f3',
        }
    },
    typography: {
        fontFamily: 'Inter, Roboto, sans-serif',
    },
    components: {
        MuiCard: {
            styleOverrides: {
                root: {
                    border: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
                    backgroundImage: 'none'
                }
            }
        },
        MuiDrawer: {
            styleOverrides: {
                paper: {
                    borderRight: '1px solid rgba(255,255,255,0.08)',
                }
            }
        },
        MuiAppBar: {
            styleOverrides: {
                root: {
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    boxShadow: 'none',
                    backgroundImage: 'none'
                }
            }
        }
    }
});

export default theme;
