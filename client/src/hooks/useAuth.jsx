import React, { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        // Check if user is logged in
        axios.get('/api/v1/auth/me')
            .then(res => {
                setUser(res.data.user);
            })
            .catch(() => {
                setUser(null);
            })
            .finally(() => {
                setLoading(false);
            });
    }, []);

    const login = async (email, password) => {
        const res = await axios.post('/api/v1/auth/login', { email, password });

        // Automatically fetch user info right after a successful login
        const meRes = await axios.get('/api/v1/auth/me');
        setUser(meRes.data.user);

        if (res.data.must_change_password) {
            navigate('/settings');
        } else {
            navigate('/dashboard');
        }
        return res.data;
    };

    const logout = async () => {
        await axios.post('/api/v1/auth/logout');
        setUser(null);
        navigate('/login');
    };

    return (
        <AuthContext.Provider value={{ user, login, logout, loading, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);
