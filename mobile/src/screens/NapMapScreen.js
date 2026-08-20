import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  ActivityIndicator, Alert, FlatList 
} from 'react-native';
import MapView, { Marker, Callout, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { napsAPI } from '../services/api';
import { debounce, parseCoordinate } from '../utils/helpers';

const COLORS = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
  primary: '#c8956c',
  dark: '#1a1d23',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
  blue: '#3b82f6',
};

const RADIUS_KM = 1;

const NapMapScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [nearbyNaps, setNearbyNaps] = useState([]);
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [location, setLocation] = useState(null);
  const [selectedNap, setSelectedNap] = useState(null);
  const [showList, setShowList] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const mapRef = useRef(null);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Location permission is required to show nearby NAPs');
        setLoading(false);
        return;
      }

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const userLoc = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
      };
      setLocation(userLoc);
      await fetchNearbyNaps(userLoc.latitude, userLoc.longitude);
    } catch (error) {
      console.error('Location error:', error);
      Alert.alert('Error', 'Failed to get location');
      setLoading(false);
    }
  };

  const fetchNearbyNaps = async (lat, lng) => {
    try {
      setLoading(true);
      const response = await napsAPI.getNearest({ 
        lat, 
        lng, 
        radius: RADIUS_KM,
        limit: 500 
      });
      setNearbyNaps(response.naps || []);
    } catch (error) {
      console.error('Error fetching nearby NAPs:', error);
    } finally {
      setLoading(false);
    }
  };

  const debouncedSearch = useCallback(
    debounce(async (query) => {
      if (query.trim().length < 2) {
        setSearchResults([]);
        setIsSearching(false);
        return;
      }

      try {
        setSearching(true);
        const response = await napsAPI.search({ q: query, limit: 100 });
        setSearchResults(response.naps || []);
      } catch (error) {
        console.error('Error searching NAPs:', error);
      } finally {
        setSearching(false);
      }
    }, 300),
    []
  );

  const handleSearchChange = (text) => {
    setSearchQuery(text);
    setIsSearching(text.trim().length >= 2);
    debouncedSearch(text);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setIsSearching(false);
  };

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
    setSelectedNap(nap);
    setShowList(false);
  };

  const refreshNearby = async () => {
    if (location) {
      await fetchNearbyNaps(location.latitude, location.longitude);
    }
  };

  const getMarkerColor = (vacantLines) => {
    if (vacantLines === 0) return COLORS.red;
    if (vacantLines <= 8) return COLORS.yellow;
    return COLORS.green;
  };

  const renderNapMarker = (nap) => {
    const c = parseCoordinate(nap.dp_nap_lat, nap.dp_nap_long);
    if (!c) return null;
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <Marker
        key={nap.id}
        coordinate={c}
        pinColor={color}
        onPress={() => setSelectedNap(nap)}
      >
        <Callout onPress={() => setSelectedNap(nap)}>
          <View style={styles.callout}>
            <Text style={styles.calloutTitle}>{nap.nap_id}</Text>
            <Text style={styles.calloutText}>{nap.building_served || 'N/A'}</Text>
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
  };

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
          <Text style={styles.listItemTitle}>{nap.nap_id}</Text>
          <FieldRow label="Physical Status" value={nap.naps_status} />
          <FieldRow label="NAP Location" value={nap.location_type} />
          <FieldRow label="NAP Address" value={address} />
        </View>
      </TouchableOpacity>
    );
  };

  const displayNaps = isSearching ? searchResults : nearbyNaps;
  const initialRegion = location 
    ? { ...location, latitudeDelta: 0.01, longitudeDelta: 0.01 }
    : { latitude: 10.3157, longitude: 123.8854, latitudeDelta: 0.5, longitudeDelta: 0.5 };

  return (
    <View style={styles.container}>
      {/* Search Bar */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search NAP ID, Building, City..."
          placeholderTextColor={COLORS.gray}
          value={searchQuery}
          onChangeText={handleSearchChange}
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

      {/* Status Bar */}
      <View style={styles.statusBar}>
        <View style={styles.statusLeft}>
          <Text style={styles.statusText}>
            {isSearching 
              ? `${searchResults.length} search results`
              : `${nearbyNaps.length} NAPs within ${RADIUS_KM}km`
            }
          </Text>
        </View>
        <TouchableOpacity onPress={() => setShowList(!showList)} style={styles.listToggle}>
          <Text style={styles.listToggleText}>
            {showList ? '🗺️ Map' : '📋 List'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={true}
        followsUserLocation={false}
      >
        {/* 1km radius circle */}
        {location && !isSearching && (
          <Circle
            center={location}
            radius={RADIUS_KM * 1000}
            fillColor="rgba(200, 149, 108, 0.08)"
            strokeColor={COLORS.primary}
            strokeWidth={1}
          />
        )}

        {/* NAP markers */}
        {displayNaps.map(renderNapMarker)}
      </MapView>

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

      {/* Selected NAP Detail */}
      {selectedNap && (
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
          </View>

          <View style={styles.detailInfo}>
            <InfoRow label="Building" value={selectedNap.building_served || 'N/A'} />
            <InfoRow label="Floors" value={selectedNap.floors_served || 'N/A'} />
            <InfoRow label="City" value={selectedNap.city_name || 'N/A'} />
            <InfoRow label="Province" value={selectedNap.province_name || 'N/A'} />
            <InfoRow label="OLT" value={selectedNap.cabinet || 'N/A'} />
            {selectedNap.distance_km !== undefined && (
              <InfoRow 
                label="Distance" 
                value={
                  selectedNap.distance_km < 1 
                    ? `${Math.round(selectedNap.distance_km * 1000)}m`
                    : `${selectedNap.distance_km.toFixed(2)}km`
                } 
              />
            )}
          </View>

          <View style={styles.portsGrid}>
            <PortBox label="Total" value={selectedNap.total_capacity} color={COLORS.dark} />
            <PortBox label="Working" value={selectedNap.working_lines} color={COLORS.green} />
            <PortBox label="Available" value={selectedNap.vacant_lines} color={getMarkerColor(selectedNap.vacant_lines)} />
          </View>
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
    <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
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
  searchContainer: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 20,
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
  statusBar: {
    position: 'absolute',
    top: 62,
    left: 12,
    right: 12,
    zIndex: 20,
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
  map: {
    flex: 1,
  },
  listContainer: {
    position: 'absolute',
    top: 92,
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
  listItemTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.dark,
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
