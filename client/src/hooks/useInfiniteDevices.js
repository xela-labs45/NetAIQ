import { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

export function useInfiniteDevices(mainTab, filters, depends = true) {
  const [devices, setDevices] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  
  // Track current fetch parameters to avoid outdated renders
  const latestFetchRef = useRef(0);

  const fetchDevices = useCallback(async (isLoadMore) => {
    if (!depends) return;
    if (loading) return;
    
    // Increment timestamp ID to track this specific fetch sequence
    const fetchId = Date.now();
    latestFetchRef.current = fetchId;
    
    setLoading(true);
    
    try {
      const currentPage = isLoadMore ? page : 1;
      const limit = 20;
      
      const params = new URLSearchParams();
      params.append('page', currentPage);
      params.append('limit', limit);
      
      Object.keys(filters).forEach(key => {
        if (filters[key] !== 'all' && filters[key] !== '') {
           params.append(key, filters[key]);
        }
      });
      
      const endpoint = mainTab === 'online' ? '/api/v1/devices/online' : '/api/v1/discovery/discovered';
      
      const response = await axios.get(`${endpoint}?${params.toString()}`);
      const data = response.data;
      
      // If a newer fetch was started, discard these results
      if (latestFetchRef.current !== fetchId) return;

      if (isLoadMore) {
        setDevices(prev => [...prev, ...data.devices]);
      } else {
        setDevices(data.devices || []);
      }
      
      setHasMore(data.pagination ? data.pagination.hasMore : false);
      setTotalCount(data.pagination ? data.pagination.total : (data.devices?.length || 0));
      
      if (isLoadMore) {
        setPage(prev => prev + 1);
      } else {
        setPage(2); // Next page to fetch will be 2
      }
      
    } catch (err) {
      console.error('Failed to fetch devices', err);
    } finally {
      if (latestFetchRef.current === fetchId) {
        setLoading(false);
        setInitialLoading(false);
      }
    }
  }, [mainTab, filters, page, loading, depends]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    fetchDevices(true);
  }, [loading, hasMore, fetchDevices]);

  // Reset and fetch on filter or tab change
  useEffect(() => {
    if (!depends) return;
    setInitialLoading(true);
    setDevices([]);
    setPage(1);
    setHasMore(true);
    fetchDevices(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, JSON.stringify(filters), depends]);

  // Refetch action triggers a complete reload
  const refetch = useCallback(() => {
    setInitialLoading(true);
    fetchDevices(false);
  }, [fetchDevices]);

  return {
    devices,
    hasMore,
    loading,
    initialLoading,
    totalCount,
    loadMore,
    refetch
  };
}
