import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, FlatList, Keyboard
} from 'react-native';
import MapView, { Marker, Callout, Circle, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../context/AuthContext';
import { napsAPI } from '../services/api';
import { fetchRoute } from '../services/routing';
import { debounce, parseCoordinate, parseCoordinateInput, formatCoords, formatDateTime, distanceMeters } from '../utils/helpers';
import { getCachedNapsUpdatedAt, cacheNapsUpdatedAt } from '../services/cache';
import StatusBadge from '../components/StatusBadge';

const COLORS = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
  primary: '#c8956c',
  dark: '#1a1d23',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
  blue: '#3b82f6',
  pin: '#7c3aed',
};

const RADIUS_KM = 1;
const RADIUS_M = RADIUS_KM * 1000;
const NEARBY_LIMIT = 1000;
const MIN_REFRESH_DISTANCE_M = 50;
const LIVE_UPDATE_DISTANCE_M = 25;
const LIVE_UPDATE_INTERVAL_MS = 10000;
const NEARBY_REFRESH_DEBOUNCE_MS = 1200;
// Fallback bias center (Cebu) when neither the visible map region nor GPS has a usable coordinate.
const MAP_DEFAULT_CENTER = { latitude: 10.3157, longitude: 123.8854 };

const STATUS_FILTERS = [
  { label: 'All', value: '' },
  { label: 'In Service', value: 'In Service' },
  { label: 'Out of Service', value: 'Defective' },
  { label: 'Planned', value: 'Planned' },
];

const formatLatLng = (lat, lng) => {
  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  if (!Number.isFinite(latNum) || !Number.isFinite(lngNum)) return 'N/A';
  return `${latNum.toFixed(6)}, ${lngNum.toFixed(6)}`;
};

const copyToClipboard = async (text) => {
  try {
    await Clipboard.setStringAsync(text);
    Alert.alert('Copied', 'Copied to clipboard');
  } catch (error) {
    Alert.alert('Copy failed', 'Could not copy to clipboard');
  }
};

const getMarkerColor = (vacantLines) => {
  if (vacantLines === 0) return COLORS.red;
  if (vacantLines <= 8) return COLORS.yellow;
  return COLORS.green;
};

const NapMapScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [nearbyNaps, setNearbyNaps] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [placeResults, setPlaceResults] = useState([]);
  const [placesPhase, setPlacesPhase] = useState('idle'); // 'idle' | 'loading' | 'error' | 'empty' | 'done'
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);

  const [location, setLocation] = useState(null);
  const [selectedNap, setSelectedNap] = useState(null);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [showList, setShowList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [napError, setNapError] = useState(false); // NAP engine error flag (unified panel shows per-engine Retry)
  const [droppedPin, setDroppedPin] = useState(null);
  const [searchMarker, setSearchMarker] = useState(null);
  const [coordinateSearchResult, setCoordinateSearchResult] = useState(null);
  const [routePoints, setRoutePoints] = useState([]);
  const [routeDistanceKm, setRouteDistanceKm] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [dataDate, setDataDate] = useState(null);
  const [dataDateError, setDataDateError] = useState(false);
  const [locating, setLocating] = useState(false);
  const mapRef = useRef(null);
  const napSeqRef = useRef(0);     // guards NAP-search responses (unified search engine #1)
  const placeSeqRef = useRef(0);   // guards Photon responses (unified search engine #2)
  const nearbySeqRef = useRef(0);
  const locationRef = useRef(null);
  const droppedPinRef = useRef(null);
  const isSearchingRef = useRef(false);
  const lastFetchedCenterRef = useRef(null);
  const fetchNearbyNapsRef = useRef(null);
  const lastRouteRef = useRef({ napId: null, origin: null });
  const mapRegionRef = useRef(null);        // latest visible map region (Photon bias source)
  const lastPlacesQueryRef = useRef(null);  // last non-empty places query (Retry target)
  const lastUnifiedQueryRef = useRef(null); // latest settled unified query (section Retry targets)
  const myLocationBusyRef = useRef(false);
  const watcherRef = useRef(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const loadStats = () => {
      napsAPI.getStats()
        .then((stats) => {
          if (cancelled) return;
          const value = stats.nap_report_date || stats.last_data_update;
          if (value) {
            setDataDate(value);
            setDataDateError(false);
            cacheNapsUpdatedAt(value);
          }
        })
        .catch(() => {
          if (!cancelled) setDataDateError(true);
        });
    };
    getCachedNapsUpdatedAt().then((value) => {
      if (value && !cancelled) setDataDate(value);
    });
    loadStats();
    const retry = setInterval(() => {
      if (attempts++ >= 10) { clearInterval(retry); return; }
      loadStats();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(retry);
    };
  }, []);

  const fetchNearbyNaps = useCallback(async (lat, lng, opts = {}) => {
    const { silent = false } = opts;
    const seq = ++nearbySeqRef.current;
    try {
      if (!silent) setLoading(true);
      const response = await napsAPI.getNearest({ 
        lat, 
        lng, 
        radius: RADIUS_KM,
        limit: NEARBY_LIMIT 
      });
      if (seq !== nearbySeqRef.current) return;
      setNearbyNaps(response.naps || []);
    } catch (error) {
      if (seq === nearbySeqRef.current) {
        console.error('Error fetching nearby NAPs:', error);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNearbyNapsRef.current = fetchNearbyNaps;
  }, [fetchNearbyNaps]);

  const debouncedFetchNearby = useMemo(
    () =>
      debounce((lat, lng) => {
        if (!isMountedRef.current) return;
        lastFetchedCenterRef.current = { latitude: lat, longitude: lng };
        fetchNearbyNapsRef.current?.(lat, lng, { silent: true });
      }, NEARBY_REFRESH_DEBOUNCE_MS),
    []
  );

  const handleLivePosition = useCallback(
    (loc) => {
      const coordinate = parseCoordinate(loc?.coords?.latitude, loc?.coords?.longitude);
      if (!coordinate) return;
      locationRef.current = coordinate;
      setLocation(coordinate);

      if (droppedPinRef.current || isSearchingRef.current) return;

      const lastCenter = lastFetchedCenterRef.current;
      if (!lastCenter || distanceMeters(lastCenter, coordinate) >= MIN_REFRESH_DISTANCE_M) {
        debouncedFetchNearby(coordinate.latitude, coordinate.longitude);
      }
    },
    [debouncedFetchNearby]
  );

  useEffect(() => {
    isSearchingRef.current = isSearching;
  }, [isSearching]);

  useEffect(() => {
    droppedPinRef.current = droppedPin;
  }, [droppedPin]);

  const startLiveWatcher = useCallback(async () => {
    if (watcherRef.current) return;
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return;
    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: LIVE_UPDATE_DISTANCE_M,
          timeInterval: LIVE_UPDATE_INTERVAL_MS,
        },
        handleLivePosition
      );
      if (!isMountedRef.current) {
        subscription?.remove?.();
        return;
      }
      watcherRef.current = subscription;
    } catch (error) {
      console.error('Watch error:', error);
    }
  }, [handleLivePosition]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      watcherRef.current?.remove?.();
      watcherRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (status !== 'granted') {
          Alert.alert('Permission Denied', 'Location permission is required to show nearby NAPs');
          setLoading(false);
          return;
        }

        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          if (cancelled) return;
          const coordinate = parseCoordinate(loc.coords.latitude, loc.coords.longitude);
          if (coordinate) {
            locationRef.current = coordinate;
            lastFetchedCenterRef.current = coordinate;
            setLocation(coordinate);
            await fetchNearbyNaps(coordinate.latitude, coordinate.longitude);
          }
        } catch (error) {
          console.error('Location error:', error);
          if (!cancelled) setLoading(false);
        }

        if (cancelled) return;
        await startLiveWatcher();
      } catch (error) {
        console.error('Location setup error:', error);
        if (!cancelled) setLoading(false);
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [fetchNearbyNaps, startLiveWatcher]);

  const performNapSearch = useCallback(async (query) => {
    if (query.trim().length < 2) {
      napSeqRef.current++;
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const seq = ++napSeqRef.current;
    try {
      setSearching(true);
      const response = await napsAPI.search({ q: query, limit: 100, status: statusFilter || undefined });
      if (seq !== napSeqRef.current) return;
      setNapError(false);
      const naps = response.naps || [];
      setSearchResults(naps);
      // Empty NAP search: one labeled "Nearby places" Photon fallback per
      // settled search (never per keystroke; never while coordinate mode).
      if (!naps.length && !coordinateSearchResult) {
        runPlacesSearch(query);
      }
    } catch (error) {
      console.error('Error searching NAPs:', error);
      setNapError(true);
    } finally {
      if (seq === napSeqRef.current) {
        setSearching(false);
      }
    }
  }, [statusFilter, coordinateSearchResult, runPlacesSearch]);

  // Unified search: NAP database + Photon places in parallel on every settled
  // query. Each engine guards its own sequence ref, so a NAP response can
  // never clobber a fresher Photon response (or vice versa).
  const runUnifiedSearch = useCallback(async (query) => {
    const q = String(query || '').trim();
    if (q.length < 2) {
      napSeqRef.current++;
      placeSeqRef.current++;
      setSearchResults([]);
      setPlaceResults([]);
      setIsSearching(false);
      setPlacesPhase('idle');
      setNapError(false);
      return;
    }
    // Keystroke path: an Enter flush just happened (or is pending) for this
    // identical query — don't repeat it 350 ms later.
    lastFlushQueryRef.current = null;
    lastUnifiedQueryRef.current = q;
    performNapSearch(q);
    runPlacesSearch(q);
  }, [performNapSearch, runPlacesSearch]);

  const lastFlushRef = useRef(0);
  const lastFlushQueryRef = useRef(null); // target of an Enter flush (600 ms suppression)
  const debouncedUnified = useMemo(
    () => debounce((query) => {
      if (Date.now() - lastFlushRef.current < 600 && lastFlushQueryRef.current === query) return;
      runUnifiedSearch(query);
    }, 350),
    [runUnifiedSearch]
  );

  const handleSubmitEditing = () => {
    Keyboard.dismiss();

    if (coordinateSearchResult) {
      // Coordinates: re-fly (idempotent) at the existing close-up zoom.
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coordinateSearchResult.latitude,
          longitude: coordinateSearchResult.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 800);
      }
      return;
    }

    // Flush unified search immediately (NAP + Photon in parallel).
    // Selection stays explicit — Enter never auto-selects a place.
    const q = searchQuery.trim();
    if (q.length >= 2) {
      lastFlushRef.current = Date.now();
      lastFlushQueryRef.current = q;
      runUnifiedSearch(q);
    }
  };

  const handleSearchChange = (text) => {
    setSearchQuery(text);

    // Check for coordinate input first (works in any search)
    const coords = parseCoordinateInput(text);
    if (coords) {
      setIsSearching(false);
      setSearchResults([]);
      setCoordinateSearchResult(coords);
      setDroppedPin(null); // BUG-002: a coordinate wins over a dropped pin
      setSearchMarker(coords);
      // Clear engine outputs/phases while in coordinate mode
      setPlaceResults([]);
      setPlacesPhase('idle');
      setNapError(false);
      // Fly to location
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: coords.latitude,
          longitude: coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        }, 800);
      }
      return;
    }

    setCoordinateSearchResult(null);
    setSearchMarker(null);

    setIsSearching(text.trim().length >= 2);
    debouncedUnified(text);
  };

  const handleStatusFilter = (value) => {
    setStatusFilter(value);
    if (searchQuery.trim().length >= 2) {
      performNapSearch(searchQuery);
    }
  };

  const clearSearch = () => {
    napSeqRef.current++;
    placeSeqRef.current++;
    setSearchQuery('');
    setSearchResults([]);
    setPlaceResults([]);
    setIsSearching(false);
    setCoordinateSearchResult(null);
    setSearchMarker(null);
    setPlacesPhase('idle');
    setNapError(false);
  };

  // Photon bias source: the visible map region if any (preferred over GPS so a
  // user browsing another area gets results there), else GPS, else Cebu.
  const biasCenter = () => {
    if (mapRegionRef.current) return mapRegionRef.current;
    if (locationRef.current) return locationRef.current;
    return MAP_DEFAULT_CENTER;
  };

  // Result-type zoom deltas (web-app convention): province-wide → city →
  // street/POI close-up. Unknown or missing classification falls to the
  // close-up default via placeKind's own fallback.
  const deltaFor = (kind) => {
    switch (kind) {
      case 'Province': return 1.0;
      case 'City': return 0.1;
      default: return 0.01;
    }
  };

  // Shared Photon runner (no API key required). Phases: loading → empty |
  // error | done. Stale responses (superseded seq) are dropped untouched.
  const runPlacesSearch = useCallback(async (query) => {
    const q = String(query || '').trim();
    if (q.length < 2) {
      lastPlacesQueryRef.current = null;
      setPlaceResults([]);
      setPlacesPhase('idle');
      return;
    }
    const seq = ++placeSeqRef.current;
    lastPlacesQueryRef.current = q;
    setPlacesPhase('loading');
    try {
      const c = biasCenter();
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(
        `https://photon.komoot.io/api?q=${encodeURIComponent(q)}&lat=${c.latitude.toFixed(4)}&lon=${c.longitude.toFixed(4)}&lang=en&limit=8`,
        { signal: controller.signal }
      );
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json(); // malformed JSON throws → 'error'
      if (seq !== placeSeqRef.current) return;
      const feats = (d.features || []).filter((f) => f.geometry?.coordinates);
      // Dedupe Photon hits (node/way/relation records for the same place)
      const seen = new Set();
      const unique = feats.filter((f) => {
        const [lon, lat] = f.geometry.coordinates;
        const key = `${String(f.properties?.osm_type || 'n/a')}|${String(f.properties?.osm_id ?? 'n/a')}|${Math.round(lat * 1e5)}|${Math.round(lon * 1e5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setPlaceResults(unique);
      setPlacesPhase(unique.length ? 'done' : 'empty');
    } catch (error) {
      console.error('Places search error:', error);
      if (seq !== placeSeqRef.current) return;
      setPlacesPhase('error');
    }
  }, []);

  const retryPlacesSearch = useCallback(() => {
    if (lastPlacesQueryRef.current) {
      runPlacesSearch(lastPlacesQueryRef.current);
    }
  }, [runPlacesSearch]);

  const flyToPlace = (feature) => {
    const [lon, lat] = feature.geometry?.coordinates || [];
    const c = parseCoordinate(lat, lon);
    if (!c) return;
    Keyboard.dismiss();
    const delta = deltaFor(placeKind(feature));
    setDroppedPin(null);
    setSearchMarker({ latitude: c.latitude, longitude: c.longitude });
    if (mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: c.latitude,
        longitude: c.longitude,
        latitudeDelta: delta,
        longitudeDelta: delta,
      }, 800);
    }
  };

  const placeKind = (f) => {
    const p = f.properties || {};
    const k = String(p.osm_key || '').toLowerCase();
    const v = String(p.osm_value || '').toLowerCase();
    if (k === 'place' && ['state', 'province', 'region', 'county'].includes(v)) return 'Province';
    if (k === 'place' || (k === 'boundary' && v === 'administrative')) return 'City';
    if (k === 'highway') return 'Street';
    if (k === 'building' || ['house', 'apartments', 'residential', 'detached'].includes(v)) return 'House';
    return 'POI';
  };

  const selectNap = useCallback((nap) => {
    Keyboard.dismiss();
    setSelectedNap(nap);
    setDetailsExpanded(false);
  }, []);

  const flyToNap = (nap) => {
    if (!mapRef.current) return;
    const c = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
    if (!c) return;
    const region = {
      ...c,
      latitudeDelta: 0.005,
      longitudeDelta: 0.005,
    };
    mapRef.current.animateToRegion(region, 500);
    selectNap(nap);
    setShowList(false);
  };

  useEffect(() => {
    const dest = selectedNap ? parseCoordinate(selectedNap.dp_nap_lat, selectedNap.dp_nap_long) : null;
    const origin = droppedPin || location;
    if (!dest || !origin) {
      setRoutePoints([]);
      setRouteDistanceKm(null);
      setRouteLoading(false);
      lastRouteRef.current = { napId: null, origin: null };
      return;
    }

    const napId = selectedNap?.id ?? null;
    const previous = lastRouteRef.current;
    const sameTarget = previous.napId === napId;
    const originMoved = !previous.origin || distanceMeters(previous.origin, origin) >= MIN_REFRESH_DISTANCE_M;
    if (sameTarget && !originMoved) return;
    lastRouteRef.current = { napId, origin };

    let cancelled = false;
    setRouteLoading(true);
    fetchRoute(origin, dest)
      .then((route) => {
        if (cancelled) return;
        setRoutePoints(route.points);
        setRouteDistanceKm(route.distanceKm);
      })
      .catch(() => {
        if (cancelled) return;
        setRoutePoints([]);
        setRouteDistanceKm(null);
      })
      .finally(() => {
        if (!cancelled) setRouteLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedNap, droppedPin, location]);

  const handleMapLongPress = useCallback(async (e) => {
    const coordinate = parseCoordinate(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
    if (!coordinate) return;
    droppedPinRef.current = coordinate;
    setDroppedPin(coordinate);
    setSelectedNap(null);
    lastFetchedCenterRef.current = coordinate;
    await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
    mapRef.current?.animateToRegion({ ...coordinate, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
  }, [fetchNearbyNaps]);

  const handlePinDrag = useCallback((e) => {
    const coordinate = parseCoordinate(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
    if (!coordinate) return;
    droppedPinRef.current = coordinate;
    setDroppedPin(coordinate);
  }, []);

  const handlePinDragEnd = useCallback(async (e) => {
    const coordinate = parseCoordinate(e.nativeEvent.coordinate.latitude, e.nativeEvent.coordinate.longitude);
    if (!coordinate) return;
    droppedPinRef.current = coordinate;
    setDroppedPin(coordinate);
    lastFetchedCenterRef.current = coordinate;
    await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
  }, [fetchNearbyNaps]);

  const clearPin = useCallback(async () => {
    droppedPinRef.current = null;
    setDroppedPin(null);
    const current = locationRef.current || location;
    if (current) {
      lastFetchedCenterRef.current = current;
      await fetchNearbyNaps(current.latitude, current.longitude, { silent: true });
      mapRef.current?.animateToRegion({ ...current, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
    }
  }, [fetchNearbyNaps, location]);

  const handleMyLocation = useCallback(async () => {
    if (myLocationBusyRef.current) return;
    myLocationBusyRef.current = true;
    setLocating(true);
    try {
      let permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        permission = await Location.requestForegroundPermissionsAsync();
      }
      if (permission.status !== 'granted') {
        Alert.alert(
          'Location Permission Needed',
          'Please allow location access so the map can center on your current position.'
        );
        return;
      }

      let coordinate = null;
      try {
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        coordinate = parseCoordinate(position?.coords?.latitude, position?.coords?.longitude);
      } catch (error) {
        console.error('My location error:', error);
      }

      if (!coordinate) {
        coordinate = locationRef.current;
      }

      if (!coordinate) {
        Alert.alert(
          'Location Unavailable',
          "We couldn't determine your current location. Please make sure GPS is enabled and try again."
        );
        return;
      }

      droppedPinRef.current = null;
      setDroppedPin(null);
      locationRef.current = coordinate;
      lastFetchedCenterRef.current = coordinate;
      setLocation(coordinate);

      mapRef.current?.animateToRegion(
        { ...coordinate, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        400
      );

      await fetchNearbyNaps(coordinate.latitude, coordinate.longitude, { silent: true });
      await startLiveWatcher();
    } finally {
      myLocationBusyRef.current = false;
      setLocating(false);
    }
  }, [fetchNearbyNaps, startLiveWatcher]);

  const renderNapMarker = useCallback((nap) => {
    const c = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
    if (!c) return null;
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <Marker
        key={nap.id}
        coordinate={c}
        pinColor={color}
        onPress={() => selectNap(nap)}
      >
        <Callout onPress={() => selectNap(nap)}>
          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>{nap.nap_id}</Text>
            <Text style={styles.calloutText}>{nap.building_served || 'N/A'}</Text>
            <Text style={styles.calloutText}>
              Status: {nap.naps_status || 'N/A'}
            </Text>
            <Text style={[styles.calloutText, { color }]}>
              {nap.vacant_lines} of {nap.total_capacity} ports available
            </Text>
            {nap.distance_km !== undefined && (
              <Text style={styles.calloutText}>
                {nap.distance_km < 1
                  ? `${Math.round(nap.distance_km * 1000)}m away`
                  : `${nap.distance_km.toFixed(1)}km away`
                }
              </Text>
            )}
          </View>
        </Callout>
      </Marker>
    );
  }, [selectNap]);

  const renderNapListItem = ({ item: nap }) => {
    const color = getMarkerColor(nap.vacant_lines);
    const address = [nap.barangay_name, nap.city_name, nap.province_name].filter(Boolean).join(', ') || 'N/A';
    return (
      <TouchableOpacity 
        style={styles.listItem}
        onPress={() => flyToNap(nap)}
      >
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <View style={styles.listItemContent}>
          <View style={styles.listItemTitleRow}>
            <Text style={styles.listItemTitle} numberOfLines={1}>{nap.nap_id}</Text>
            <StatusBadge status={nap.naps_status} />
          </View>
          <Text style={styles.listItemSubtitle} numberOfLines={1}>
            {nap.building_served || 'N/A'}
          </Text>
          <FieldRow label="Physical Status" value={nap.naps_status} />
          <FieldRow label="NAP Location" value={nap.location_type} />
          <FieldRow label="NAP Address" value={address} />
        </View>
      </TouchableOpacity>
    );
  };

  const selectedDistanceText = selectedNap
    ? !routeLoading && routeDistanceKm !== null && routeDistanceKm !== undefined
      ? (routeDistanceKm < 1 ? `${Math.round(routeDistanceKm * 1000)}m` : `${routeDistanceKm.toFixed(2)}km`)
      : selectedNap.distance_km !== undefined
        ? (selectedNap.distance_km < 1 ? `${Math.round(selectedNap.distance_km * 1000)}m` : `${selectedNap.distance_km.toFixed(2)}km`)
        : null
    : null;

  const activeCoordinate = droppedPin || location;
  const displayNaps = isSearching ? searchResults : nearbyNaps;
  const nearbyCapReached = !isSearching && nearbyNaps.length >= NEARBY_LIMIT;
  const napMarkers = useMemo(
    () => displayNaps.map(renderNapMarker),
    [displayNaps, renderNapMarker]
  );
  const initialRegion = location 
    ? { ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : { latitude: 10.3157, longitude: 123.8854, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  /** Unified results panel (Task 2) */

  /** Single NAP facility row inside the unified results panel. */
  const renderNapSearchRow = ({ item: nap }) => {
    const color = getMarkerColor(nap.vacant_lines);
    const address = [nap.barangay_name, nap.city_name, nap.province_name].filter(Boolean).join(', ') || 'N/A';
    return (
      <TouchableOpacity style={styles.unifiedNapRow} onPress={() => flyToNap(nap)}>
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <View style={styles.unifiedNapContent}>
          <View style={styles.unifiedNapTitleRow}>
            <Text style={styles.unifiedNapTitle} numberOfLines={1}>{nap.nap_id}</Text>
            <StatusBadge status={nap.naps_status} />
          </View>
          <Text style={styles.unifiedNapSubtitle} numberOfLines={1}>{nap.building_served || 'N/A'}</Text>
          <Text style={styles.unifiedNapAddress} numberOfLines={1}>{address}</Text>
        </View>
      </TouchableOpacity>
    );
  };

  /** One panel, two labeled sections: registered NAP facilities first, then
   * external places from Photon. Each section owns its loading/error/empty
   * state so one engine failing never hides the other's results. */
  const renderUnifiedResults = () => {
    if (coordinateSearchResult) return null;
    if (searchQuery.trim().length < 2) return null;

    const bothSettled = !isSearching && placesPhase !== 'loading';
    const nothingFound = bothSettled && searchResults.length === 0 && placeResults.length === 0;

    return (
      <View style={styles.unifiedResultsContainer}>
        {/* NAP FACILITIES — registered facilities from /api/naps/search */}
        <View style={styles.unifiedSection}>
          <Text style={styles.sectionLabel}>NAP FACILITIES</Text>
          {isSearching ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.sectionLoadingText}>Searching NAP facilities…</Text>
            </View>
          ) : napError ? (
            <View style={styles.sectionError}>
              <Text style={styles.sectionErrorText}>NAP search unavailable</Text>
              <TouchableOpacity
                style={styles.sectionRetry}
                onPress={() => {
                  if (lastUnifiedQueryRef.current) performNapSearch(lastUnifiedQueryRef.current);
                }}
              >
                <Text style={styles.sectionRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => String(item.id ?? item.nap_id)}
              keyboardShouldPersistTaps="handled"
              renderItem={renderNapSearchRow}
              style={styles.unifiedList}
            />
          ) : null}
        </View>

        {/* PLACES & LOCATIONS — external results from Photon */}
        <View style={styles.unifiedSection}>
          <Text style={styles.sectionLabel}>PLACES &amp; LOCATIONS</Text>
          {placesPhase === 'loading' ? (
            <View style={styles.sectionLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.sectionLoadingText}>Searching places…</Text>
            </View>
          ) : placesPhase === 'error' ? (
            <View style={styles.sectionError}>
              <Text style={styles.sectionErrorText}>Places search unavailable</Text>
              <TouchableOpacity style={styles.sectionRetry} onPress={retryPlacesSearch}>
                <Text style={styles.sectionRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : placesPhase === 'empty' ? (
            <Text style={styles.sectionEmptyText}>No places found</Text>
          ) : placeResults.length > 0 ? (
            <FlatList
              data={placeResults}
              keyExtractor={(item, index) => `place-${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const p = item.properties || {};
                const [lon, lat] = item.geometry.coordinates;
                const kind = placeKind(item);
                const sub = [p.district, p.locality, p.city, p.county, p.state]
                  .map((x) => String(x || '').trim()).filter(Boolean).join(', ');
                return (
                  <TouchableOpacity style={styles.unifiedPlaceRow} onPress={() => flyToPlace(item)}>
                    <View style={styles.placeResultDot} />
                    <View style={styles.unifiedPlaceContent}>
                      <Text style={styles.placeResultName}>{p.name || searchQuery}</Text>
                      <Text style={styles.placeResultSub}>{kind}{sub ? ` · ${sub}` : ''}</Text>
                      <Text style={styles.placeResultCoords}>{formatCoords(lat, lon)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
              style={styles.unifiedList}
            />
          ) : null}
        </View>

        {nothingFound && (
          <View style={styles.noResultsAll}>
            <Text style={styles.noResultsText}>No results found</Text>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search + results overlay — one stacked column above the map */}
      <View style={styles.searchStack}>
        {/* Search bar */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search NAPs, places, or coordinates..."
            placeholderTextColor={COLORS.gray}
            value={searchQuery}
            onChangeText={handleSearchChange}
            onSubmitEditing={handleSubmitEditing}
            returnKeyType="search"
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
          {searching && (
            <ActivityIndicator size="small" color={COLORS.primary} style={styles.searchLoader} />
          )}
        </View>

        {/* Coordinate Search Result Card */}
        {coordinateSearchResult && (
          <View style={styles.coordResultCard}>
            <View style={styles.coordResultHeader}>
              <Text style={styles.coordResultTitle}>📍 Specified Coordinates</Text>
              <Text style={styles.coordResultInput}>{searchQuery}</Text>
            </View>
            <View style={styles.coordResultActions}>
              <TouchableOpacity
                style={styles.coordCopyButton}
                onPress={() => copyToClipboard(formatCoords(coordinateSearchResult.latitude, coordinateSearchResult.longitude))}
              >
                <Text style={styles.coordCopyButtonText}>⧉ Copy {formatCoords(coordinateSearchResult.latitude, coordinateSearchResult.longitude)}</Text>
              </TouchableOpacity>
              <View style={styles.coordCopyRow}>
                <TouchableOpacity
                  style={[styles.coordCopyButton, styles.coordCopyButtonSmall]}
                  onPress={() => copyToClipboard(coordinateSearchResult.latitude.toFixed(6))}
                >
                  <Text style={styles.coordCopyButtonText}>Lat: {coordinateSearchResult.latitude.toFixed(6)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.coordCopyButton, styles.coordCopyButtonSmall]}
                  onPress={() => copyToClipboard(coordinateSearchResult.longitude.toFixed(6))}
                >
                  <Text style={styles.coordCopyButtonText}>Lng: {coordinateSearchResult.longitude.toFixed(6)}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Unified results panel — rendered below the coordinate card */}
        {renderUnifiedResults()}

        {/* Status Bar */}
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            <Text style={styles.statusText}>
              {isSearching
                ? `${searchResults.length} search results`
                : droppedPin
                  ? `${nearbyNaps.length} NAPs within ${RADIUS_KM}km of pin${nearbyCapReached ? ` (limit ${NEARBY_LIMIT})` : ''}`
                  : `${nearbyNaps.length} NAPs within ${RADIUS_KM}km${nearbyCapReached ? ` (limit ${NEARBY_LIMIT})` : ''}`
              }
            </Text>
            <Text style={[styles.dataDateText, dataDateError && !dataDate && styles.dataDateError]}>
              Data last updated:{' '}
              {dataDate
                ? formatDateTime(dataDate)
                : dataDateError
                  ? "(can't reach server)"
                  : '—'}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setShowList(!showList)} style={styles.listToggle}>
            <Text style={styles.listToggleText}>
              {showList ? '🗺️ Map' : '📋 List'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status filter chips (while searching) */}
        {isSearching && (
          <View style={styles.chipsRow}>
            {STATUS_FILTERS.map((f) => (
              <TouchableOpacity
                key={f.value || 'all'}
                style={[styles.chip, statusFilter === f.value && styles.chipActive]}
                onPress={() => handleStatusFilter(f.value)}
              >
                <Text style={[styles.chipText, statusFilter === f.value && styles.chipTextActive]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Pinned location banner */}
        {droppedPin && !isSearching && (
          <View style={styles.pinBanner}>
            <Text style={styles.pinBannerText}>📍 Checking around pinned spot</Text>
            <TouchableOpacity onPress={clearPin} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.pinBannerClear}>Clear ✕</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        followsUserLocation={false}
        onLongPress={handleMapLongPress}
        onRegionChangeComplete={(r) => {
          // Track the visible region center for Photon bias (ref only — no re-render).
          const c = parseCoordinate(r.latitude, r.longitude);
          if (c) mapRegionRef.current = c;
        }}
      >
        {/* 1km radius circle follows the active search coordinate */}
        {activeCoordinate && !isSearching && (
          <Circle
            center={activeCoordinate}
            radius={RADIUS_M}
            fillColor="rgba(200, 149, 108, 0.08)"
            strokeColor={COLORS.primary}
            strokeWidth={1}
          />
        )}

        {/* Dropped pin (manual search location) */}
        {droppedPin && (
          <Marker
            coordinate={droppedPin}
            pinColor={COLORS.pin}
            draggable
            onDrag={handlePinDrag}
            onDragEnd={handlePinDragEnd}
          />
        )}

        {/* Search marker (coordinate search result) */}
        {searchMarker && (
          <Marker
            coordinate={{ latitude: searchMarker.latitude, longitude: searchMarker.longitude }}
            pinColor={COLORS.pin}
          >
            <View style={styles.searchMarkerContainer}>
              <View style={styles.searchMarkerDot} />
            </View>
          </Marker>
        )}

        {/* Active route along roads from current location / pin to selected NAP */}
        {routePoints.length > 0 && (
          <Polyline
            coordinates={routePoints}
            strokeColor={COLORS.blue}
            strokeWidth={4}
          />
        )}

        {/* NAP markers */}
        {napMarkers}
      </MapView>

      {/* My Location button */}
      {!showList && !detailsExpanded && (
        <TouchableOpacity
          style={[styles.myLocationButton, locating && styles.myLocationButtonActive]}
          onPress={handleMyLocation}
          activeOpacity={0.85}
          disabled={locating}
          accessibilityRole="button"
          accessibilityLabel="My location"
          accessibilityHint="Clears any dropped pin and centers the map on your current location"
        >
          {locating ? (
            <ActivityIndicator size="small" color={COLORS.primary} />
          ) : (
            <Ionicons
              name={droppedPin ? 'locate-outline' : 'locate'}
              size={22}
              color={COLORS.primary}
            />
          )}
        </TouchableOpacity>
      )}

      {/* List View */}
      {showList && (
        <View style={styles.listContainer}>
          <FlatList
            data={displayNaps}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderNapListItem}
            initialNumToRender={20}
            maxToRenderPerBatch={20}
            windowSize={10}
            ListEmptyComponent={
              <View style={styles.emptyList}>
                <Text style={styles.emptyListText}>
                  {isSearching ? 'No search results' : 'No NAPs nearby'}
                </Text>
              </View>
            }
          />
        </View>
      )}

      {/* Selected NAP detail */}
      {selectedNap && !detailsExpanded && (
        <TouchableOpacity
          style={styles.collapsedBar}
          onPress={() => setDetailsExpanded(true)}
          activeOpacity={0.85}
        >
          <View style={[styles.statusDot, { backgroundColor: getMarkerColor(selectedNap.vacant_lines) }]} />
          <View style={styles.collapsedInfo}>
            <Text style={styles.collapsedTitle} numberOfLines={1}>{selectedNap.nap_id}</Text>
            <Text style={styles.collapsedSub} numberOfLines={1}>
              {[selectedNap.building_served, selectedDistanceText].filter(Boolean).join(' · ') || 'N/A'}
            </Text>
          </View>
          <StatusBadge status={selectedNap.naps_status} />
          <Text style={styles.expandText}>▲ Details</Text>
        </TouchableOpacity>
      )}

      {selectedNap && detailsExpanded && (
        <View style={styles.detailPanel}>
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={() => setSelectedNap(null)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
          
          <View style={styles.detailHeader}>
            <View style={[styles.statusDot, { backgroundColor: getMarkerColor(selectedNap.vacant_lines) }]} />
            <View style={styles.detailTitleContainer}>
              <Text style={styles.detailTitle}>{selectedNap.nap_id}</Text>
              <Text style={styles.detailSubtitle}>{selectedNap.location_type}</Text>
            </View>
            <StatusBadge status={selectedNap.naps_status} size="lg" />
          </View>

          <View style={styles.detailInfo}>
            <InfoRow label="Building" value={selectedNap.building_served || 'N/A'} />
            <InfoRow label="Floors" value={selectedNap.floors_served || 'N/A'} />
            <InfoRow label="City" value={selectedNap.city_name || 'N/A'} />
            <InfoRow label="Province" value={selectedNap.province_name || 'N/A'} />
            <InfoRow label="OLT" value={selectedNap.cabinet || 'N/A'} />
            <InfoRow label="Status" value={selectedNap.naps_status || 'N/A'} />
            <InfoRow
              label="Lat / Long"
              value={formatLatLng(selectedNap.dp_nap_lat, selectedNap.dp_nap_long)}
            />
            {selectedNap.distance_km !== undefined && !routeLoading && routeDistanceKm === null && (
              <InfoRow 
                label="Distance" 
                value={
                  selectedNap.distance_km < 1 
                    ? `${Math.round(selectedNap.distance_km * 1000)}m`
                    : `${selectedNap.distance_km.toFixed(2)}km`
                } 
              />
            )}
            {routeLoading && <InfoRow label="Distance" value="Measuring walking route..." />}
            {!routeLoading && routeDistanceKm !== null && routeDistanceKm !== undefined && (
              <InfoRow
                label="Distance (walking)"
                value={
                  routeDistanceKm < 1
                    ? `${Math.round(routeDistanceKm * 1000)}m`
                    : `${routeDistanceKm.toFixed(2)}km`
                }
              />
            )}
          </View>

          <View style={styles.portsGrid}>
            <PortBox label="Total" value={selectedNap.total_capacity} color={COLORS.dark} />
            <PortBox label="Working" value={selectedNap.working_lines} color={COLORS.green} />
            <PortBox label="Available" value={selectedNap.vacant_lines} color={getMarkerColor(selectedNap.vacant_lines)} />
          </View>

          <TouchableOpacity
            onPress={() => setDetailsExpanded(false)}
            style={styles.collapseBtn}
          >
            <Text style={styles.collapseBtnText}>▼ Show less (see map)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Loading overlay */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading nearby NAPs...</Text>
        </View>
      )}
    </View>
  );
};

const InfoRow = ({ label, value }) => (
  <View style={styles.infoRow}>
    <Text style={styles.infoLabel}>{label}</Text>
    <Text
      style={styles.infoValue}
      numberOfLines={1}
      onLongPress={() => copyToClipboard(value)}
    >
      {value}
    </Text>
  </View>
);

const FieldRow = ({ label, value }) => (
  <Text style={styles.listItemField} numberOfLines={1}>
    <Text style={styles.listItemFieldLabel}>{label}: </Text>
    {value || 'N/A'}
  </Text>
);

const PortBox = ({ label, value, color }) => (
  <View style={styles.portBox}>
    <Text style={[styles.portValue, { color }]}>{value}</Text>
    <Text style={styles.portLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchStack: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 14,
    fontSize: 15,
    color: COLORS.dark,
  },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  clearButtonText: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: 'bold',
  },
  searchLoader: {
    marginLeft: 8,
  },
  coordResultCard: {
    backgroundColor: '#fff',
    marginTop: 8,
    borderRadius: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  coordResultHeader: {
    marginBottom: 8,
  },
  coordResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
  },
  coordResultInput: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  coordResultActions: {
    gap: 6,
  },
  coordCopyButton: {
    backgroundColor: COLORS.lightGray,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  coordCopyButtonSmall: {
    flex: 1,
  },
  coordCopyButtonText: {
    fontSize: 12,
    color: COLORS.dark,
    fontWeight: '500',
  },
  coordCopyRow: {
    flexDirection: 'row',
    gap: 6,
  },
  searchMarkerContainer: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchMarkerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.pin,
    borderWidth: 2,
    borderColor: '#fff',
    shadowColor: COLORS.pin,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },

  placeResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  placeResultDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.gray,
    marginRight: 12,
  },
  placeResultContent: {
    flex: 1,
  },
  placeResultName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
  },
  placeResultSub: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  placeResultCoords: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  placeNoResults: {
    padding: 20,
    marginTop: 8,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  placeNoResultsText: {
    fontSize: 14,
    color: COLORS.gray,
  },
  placeRetryButton: {
    marginTop: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 20,
  },
  placeRetryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  unifiedResultsContainer: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
    overflow: 'hidden',
  },
  unifiedSection: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.gray,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  sectionLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
  },
  sectionLoadingText: {
    fontSize: 13,
    color: COLORS.gray,
    marginLeft: 8,
  },
  sectionError: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  sectionErrorText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  sectionRetry: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  sectionRetryText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 11,
  },
  sectionEmptyText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  noResultsAll: {
    padding: 20,
    alignItems: 'center',
  },
  noResultsText: {
    fontSize: 14,
    color: COLORS.gray,
  },
  unifiedNapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  unifiedNapContent: {
    flex: 1,
  },
  unifiedNapTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  unifiedNapTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
  },
  unifiedNapSubtitle: {
    fontSize: 12,
    color: COLORS.dark,
  },
  unifiedNapAddress: {
    fontSize: 12,
    color: COLORS.gray,
  },
  unifiedPlaceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  unifiedPlaceContent: {
    flex: 1,
  },
  unifiedList: {
    flex: 1,
  },
  statusBar: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusLeft: {
    flex: 1,
  },
  statusText: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: '500',
  },
  dataDateText: {
    fontSize: 10,
    color: COLORS.gray,
    marginTop: 2,
  },
  dataDateError: {
    color: COLORS.red,
    fontWeight: '600',
  },
  listToggle: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: COLORS.dark,
    borderRadius: 6,
  },
  listToggleText: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '600',
  },
  chipsRow: {
    marginTop: 6,
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#f3f4f6',
    marginRight: 6,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
  },
  chipText: {
    fontSize: 11,
    color: COLORS.gray,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#fff',
  },
  pinBanner: {
    marginTop: 6,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 246, 255, 0.97)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.blue,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pinBannerText: {
    fontSize: 12,
    color: COLORS.blue,
    fontWeight: '600',
  },
  pinBannerClear: {
    fontSize: 12,
    color: COLORS.red,
    fontWeight: '700',
  },
  map: {
    flex: 1,
  },
  myLocationButton: {
    position: 'absolute',
    right: 14,
    bottom: 96,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 5,
  },
  myLocationButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  listContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    zIndex: 15,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  listItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
    flexShrink: 1,
    marginRight: 8,
  },
  listItemSubtitle: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  listItemAddress: {
    fontSize: 11,
    color: COLORS.gray,
  },
  listItemField: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  listItemFieldLabel: {
    color: COLORS.dark,
    fontWeight: '600',
  },
  portLabel: {
    fontSize: 10,
    color: COLORS.gray,
  },
  emptyList: {
    padding: 40,
    alignItems: 'center',
  },
  emptyListText: {
    fontSize: 14,
    color: COLORS.gray,
  },
  callout: {
    padding: 8,
    minWidth: 150,
  },
  calloutTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  calloutText: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  detailPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 10,
  },
  collapsedBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 10,
  },
  collapsedInfo: {
    flex: 1,
    marginLeft: 10,
    marginRight: 8,
  },
  collapsedTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.dark,
  },
  collapsedSub: {
    fontSize: 12,
    color: COLORS.gray,
    marginTop: 2,
  },
  expandText: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.blue,
    marginLeft: 8,
    paddingVertical: 6,
    paddingLeft: 8,
  },
  collapseBtn: {
    alignSelf: 'center',
    marginTop: 14,
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  collapseBtnText: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 14,
    color: COLORS.gray,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
  },
  detailTitleContainer: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.dark,
  },
  detailSubtitle: {
    fontSize: 14,
    color: COLORS.gray,
  },
  detailInfo: {
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  infoLabel: {
    fontSize: 13,
    color: COLORS.gray,
  },
  infoValue: {
    fontSize: 13,
    color: COLORS.dark,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 12,
  },
  portsGrid: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: '#f9f9f9',
    borderRadius: 12,
    padding: 16,
  },
  portBox: {
    alignItems: 'center',
  },
  portValue: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  portLabel: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 4,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 30,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: COLORS.gray,
  },
});

export default NapMapScreen;
