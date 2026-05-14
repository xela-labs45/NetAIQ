import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [warnings, setWarnings] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();
    const queryClient = useQueryClient();

    useEffect(() => {
        // Check if user is logged in
        axios.get('/api/v1/auth/me')
            .then(res => {
                setUser(res.data.user);
                setWarnings(res.data.warnings || []);
            })
            .catch(() => {
                setUser(null);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    const login = async (username, password) => {
        const res = await axios.post('/api/v1/auth/login', { username, password });

        // Automatically fetch user info right after a successful login
        const meRes = await axios.get('/api/v1/auth/me');
        setUser(meRes.data.user);
        setWarnings(meRes.data.warnings || []);

        if (res.data.must_change_password) {
            navigate('/change-password');
        } else {
            navigate('/dashboard');
        }
        return res.data;
    };

    const logout = async () => {
        await axios.post('/api/v1/auth/logout');
        queryClient.clear();
        setUser(null);
        navigate('/login');
    };

    return (
        <AuthContext.Provider value={{ user, warnings, login, logout, loading, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
