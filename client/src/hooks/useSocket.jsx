import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './useAuth';
import { useQueryClient } from '@tanstack/react-query';

const SocketContext = createContext(null);

export function SocketProvider({ children }) {
    const { user } = useAuth();
    const [socket, setSocket] = useState(null);
    const socketRef = useRef(null);
    const queryClient = useQueryClient();

    useEffect(() => {
        // Cleanup function to close any existing socket
        const cleanup = () => {
            if (socketRef.current) {
                console.log('Closing socket:', socketRef.current.id);
                socketRef.current.disconnect();
                socketRef.current = null;
            }
        };

        if (user) {
            cleanup(); // Ensure fresh start

            const newSocket = io({
                withCredentials: true,
                reconnectionAttempts: 5
            });

            socketRef.current = newSocket;

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

            return cleanup;
        } else {
            cleanup();
            setSocket(null);
        }
    }, [user, queryClient]);

    return (
        <SocketContext.Provider value={socket}>
            {children}
        </SocketContext.Provider>
    );
}

export const useSocket = () => useContext(SocketContext);
