import { createTheme } from '@mui/material/styles';

const theme = createTheme({
    palette: {
        mode: 'dark',
        background: {
            default: '#0A1628',
            paper: '#0d1f3c',
        },
        primary: {
            main: '#0066FF',
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
            main: '#00E5FF',
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
