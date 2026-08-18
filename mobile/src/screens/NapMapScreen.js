import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, FlatList } from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { napsAPI } from '../services/api';

const COLORS = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
  primary: '#c8956c',
  dark: '#1a1d23',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
};

const NapMapScreen = ({ navigation }) => {
  const { user } = useAuth();
  const [naps, setNaps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [location, setLocation] = useState(null);
  const [selectedNap, setSelectedNap] = useState(null);
  const [showList, setShowList] = useState(false);
  const [stats, setStats] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    getCurrentLocation();
    fetchNaps();
    fetchStats();
  }, []);

  const getCurrentLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        setLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    } catch (error) {
      console.error('Location error:', error);
    }
  };

  const fetchNaps = async () => {
    try {
      setLoading(true);
      const response = await napsAPI.getAll({ limit: 1000 });
      setNaps(response.naps || []);
    } catch (error) {
      console.error('Error fetching NAPs:', error);
      Alert.alert('Error', 'Failed to load NAP data');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const response = await napsAPI.getStats();
      setStats(response);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const findNearestNaps = async () => {
    if (!location) {
      Alert.alert('Error', 'Location not available');
      return;
    }

    try {
      setLoading(true);
      const response = await napsAPI.getNearest({
        lat: location.latitude,
        lng: location.longitude,
        radius: 10,
        limit: 10
      });
      
      if (response.naps && response.naps.length > 0) {
        setNaps(response.naps);
        // Zoom to nearest NAPs
        mapRef.current?.fitToCoordinates(
          response.naps.map(n => ({ latitude: n.dp_nap_lat, longitude: n.dp_nap_long })),
          { edgePadding: { top: 50, right: 50, bottom: 50, left: 50 }, animated: true }
        );
      } else {
        Alert.alert('No NAPs Found', 'No NAPs with available ports found nearby');
      }
    } catch (error) {
      console.error('Error finding nearest NAPs:', error);
    } finally {
      setLoading(false);
    }
  };

  const showAllNaps = async () => {
    await fetchNaps();
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        ...location,
        latitudeDelta: 0.5,
        longitudeDelta: 0.5,
      });
    }
  };

  const getMarkerColor = (vacantLines) => {
    if (vacantLines === 0) return COLORS.red;
    if (vacantLines <= 8) return COLORS.yellow;
    return COLORS.green;
  };

  const renderNapMarker = (nap) => {
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <Marker
        key={nap.id}
        coordinate={{
          latitude: parseFloat(nap.dp_nap_lat),
          longitude: parseFloat(nap.dp_nap_long),
        }}
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
          </View>
        </Callout>
      </Marker>
    );
  };

  const renderNapListItem = ({ item: nap }) => {
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <TouchableOpacity 
        style={styles.listItem}
        onPress={() => {
          setSelectedNap(nap);
          setShowList(false);
          mapRef.current?.animateToRegion({
            latitude: parseFloat(nap.dp_nap_lat),
            longitude: parseFloat(nap.dp_nap_long),
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }}
      >
        <View style={[styles.colorDot, { backgroundColor: color }]} />
        <View style={styles.listItemContent}>
          <Text style={styles.listItemTitle}>{nap.nap_id}</Text>
          <Text style={styles.listItemSubtitle} numberOfLines={1}>
            {nap.building_served || 'N/A'}
          </Text>
          <Text style={styles.listItemAddress} numberOfLines={1}>
            {nap.city_name || 'N/A'}
          </Text>
        </View>
        <View style={styles.listItemPorts}>
          <Text style={[styles.portCount, { color }]}>{nap.vacant_lines}</Text>
          <Text style={styles.portLabel}>spare</Text>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading && naps.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.loadingText}>Loading NAP data...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header Stats */}
      {stats && (
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: COLORS.green }]}>{stats.available_naps}</Text>
            <Text style={styles.statLabel}>Available</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: COLORS.yellow }]}>{stats.warning_naps}</Text>
            <Text style={styles.statLabel}>Warning</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statValue, { color: COLORS.red }]}>{stats.full_naps}</Text>
            <Text style={styles.statLabel}>Full</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{stats.total_naps}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
        </View>
      )}

      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={location ? {
          ...location,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        } : {
          latitude: 10.3157,
          longitude: 123.8854,
          latitudeDelta: 0.5,
          longitudeDelta: 0.5,
        }}
        showsUserLocation={true}
      >
        {naps.map(renderNapMarker)}
      </MapView>

      {/* Action Buttons */}
      <View style={styles.actionBar}>
        <TouchableOpacity 
          style={[styles.actionButton, styles.primaryButton]}
          onPress={findNearestNaps}
        >
          <Text style={styles.actionButtonText}>📍 Find Nearest</Text>
        </TouchableOpacity>
        
        <TouchableOpacity 
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={showAllNaps}
        >
          <Text style={styles.actionButtonText}>🗺️ Show All</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.actionButton, styles.secondaryButton]}
          onPress={() => setShowList(!showList)}
        >
          <Text style={styles.actionButtonText}>
            {showList ? '🗺️ Map' : '📋 List'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* List View */}
      {showList && (
        <View style={styles.listContainer}>
          <FlatList
            data={naps}
            keyExtractor={(item) => item.id.toString()}
            renderItem={renderNapListItem}
            ListHeaderComponent={
              <Text style={styles.listHeader}>
                {naps.length} NAPs {location ? '(sorted by distance)' : ''}
              </Text>
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
          </View>

          <View style={styles.portsGrid}>
            <PortBox label="Total" value={selectedNap.total_capacity} color={COLORS.dark} />
            <PortBox label="Working" value={selectedNap.working_lines} color={COLORS.green} />
            <PortBox label="Available" value={selectedNap.vacant_lines} color={getMarkerColor(selectedNap.vacant_lines)} />
          </View>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: COLORS.gray,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: COLORS.dark,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 10,
    color: COLORS.gray,
    marginTop: 2,
  },
  map: {
    flex: 1,
  },
  actionBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: COLORS.lightGray,
  },
  actionButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
  },
  secondaryButton: {
    backgroundColor: COLORS.dark,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
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
  listContainer: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    bottom: 60,
    backgroundColor: '#fff',
    zIndex: 10,
  },
  listHeader: {
    padding: 12,
    fontSize: 14,
    color: COLORS.gray,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
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
  listItemPorts: {
    alignItems: 'center',
    marginLeft: 12,
  },
  portCount: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  portLabel: {
    fontSize: 10,
    color: COLORS.gray,
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
});

export default NapMapScreen;
