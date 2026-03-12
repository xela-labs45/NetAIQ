import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
    const { user } = useAuth();
    const [socket, setSocket] = useState(null);
    const queryClient = useQueryClient();

    useEffect(() => {
        if (user) {
            const newSocket = io(window.location.origin, {
                withCredentials: true
            });

            newSocket.on('connect', () => {
                console.log('Socket connected:', newSocket.id);
            });

            // Global device status listener to auto-update React Query caches
            newSocket.on('device:status', (data) => {
                // Update device lists in react query cache
                queryClient.setQueryData(['devices'], (oldData) => {
                    if (!oldData) return oldData;
                    return {
                        ...oldData,
                        data: {
                            ...oldData.data,
                            devices: oldData.data.devices.map(d => {
                                if (d.id === data.device_id) {
                                    return {
                                        ...d,
                                        status: data.status,
                                        latency_ms: data.latency_ms,
                                        last_seen: data.timestamp
                                    };
                                }
                                return d;
                            })
                        }
                    };
                });
            });

            setSocket(newSocket);

            return () => {
                newSocket.close();
            };
        } else if (socket) {
            socket.close();
            setSocket(null);
        }
    }, [user]);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
}

export const useSocket = () => useContext(SocketContext);
