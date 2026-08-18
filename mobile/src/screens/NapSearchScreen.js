import React, { useState, useCallback, useMemo } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  FlatList, ActivityIndicator, Alert 
} from 'react-native';
import MapView, { Marker, Callout } from 'react-native-maps';
import { useFocusEffect } from '@react-navigation/native';
import { napsAPI } from '../services/api';
import { debounce } from '../utils/helpers';

const COLORS = {
  green: '#22c55e',
  yellow: '#f59e0b',
  red: '#ef4444',
  primary: '#c8956c',
  dark: '#1a1d23',
  gray: '#6b7280',
  lightGray: '#e5e7eb',
};

const NapSearchScreen = ({ navigation }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedNap, setSelectedNap] = useState(null);
  const [hasSearched, setHasSearched] = useState(false);

  const debouncedSearch = useCallback(
    debounce(async (searchQuery) => {
      if (searchQuery.trim().length < 2) {
        setResults([]);
        setHasSearched(false);
        return;
      }

      try {
        setLoading(true);
        const response = await napsAPI.search({ q: searchQuery, limit: 30 });
        setResults(response.naps || []);
        setHasSearched(true);
      } catch (error) {
        console.error('Error searching NAPs:', error);
        Alert.alert('Error', 'Failed to search NAPs');
      } finally {
        setLoading(false);
      }
    }, 300),
    []
  );

  const handleSearchChange = (text) => {
    setQuery(text);
    debouncedSearch(text);
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    setSelectedNap(null);
  };

  const getMarkerColor = (vacantLines) => {
    if (vacantLines === 0) return COLORS.red;
    if (vacantLines <= 8) return COLORS.yellow;
    return COLORS.green;
  };

  const handleSelectNap = (nap) => {
    setSelectedNap(nap);
  };

  const renderNapItem = ({ item: nap }) => {
    const color = getMarkerColor(nap.vacant_lines);
    return (
      <TouchableOpacity 
        style={[styles.resultItem, selectedNap?.id === nap.id && styles.resultItemActive]}
        onPress={() => handleSelectNap(nap)}
      >
        <View style={[styles.statusDot, { backgroundColor: color }]} />
        <View style={styles.resultContent}>
          <Text style={styles.resultTitle}>{nap.nap_id}</Text>
          <Text style={styles.resultSubtitle} numberOfLines={1}>
            {nap.building_served || 'N/A'}
          </Text>
          <Text style={styles.resultAddress} numberOfLines={1}>
            {nap.city_name}, {nap.province_name}
          </Text>
        </View>
        <View style={styles.portInfo}>
          <Text style={[styles.portValue, { color }]}>
            {nap.vacant_lines}
          </Text>
          <Text style={styles.portLabel}>spare</Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.searchHeader}>
        <View style={styles.searchInputContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search NAP ID, Building, City..."
            placeholderTextColor={COLORS.gray}
            value={query}
            onChangeText={handleSearchChange}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={clearSearch} style={styles.clearButton}>
              <Text style={styles.clearButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Results Count */}
      {hasSearched && (
        <View style={styles.resultsHeader}>
          <Text style={styles.resultsText}>
            {results.length} NAP{results.length !== 1 ? 's' : ''} found
          </Text>
        </View>
      )}

      {/* Map */}
      {results.length > 0 && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: results[0]?.dp_nap_lat || 10.3157,
            longitude: results[0]?.dp_nap_long || 123.8854,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
          region={selectedNap ? {
            latitude: parseFloat(selectedNap.dp_nap_lat),
            longitude: parseFloat(selectedNap.dp_nap_long),
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          } : undefined}
        >
          {results.map((nap) => (
            <Marker
              key={nap.id}
              coordinate={{
                latitude: parseFloat(nap.dp_nap_lat),
                longitude: parseFloat(nap.dp_nap_long),
              }}
              pinColor={getMarkerColor(nap.vacant_lines)}
              onPress={() => handleSelectNap(nap)}
            >
              <Callout onPress={() => handleSelectNap(nap)}>
                <View style={styles.callout}>
                  <Text style={styles.calloutTitle}>{nap.nap_id}</Text>
                  <Text style={styles.calloutText}>{nap.building_served || 'N/A'}</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>
      )}

      {/* Results List */}
      <FlatList
        data={results}
        keyExtractor={(item) => item.id.toString()}
        renderItem={renderNapItem}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          hasSearched && !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔍</Text>
              <Text style={styles.emptyText}>No NAPs found</Text>
              <Text style={styles.emptySubtext}>Try a different search term</Text>
            </View>
          ) : !hasSearched ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>📍</Text>
              <Text style={styles.emptyText}>Search for a NAP</Text>
              <Text style={styles.emptySubtext}>
                Enter NAP ID, building name, or city to find it on the map
              </Text>
            </View>
          ) : null
        }
        ListHeaderComponent={
          loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : null
        }
      />

      {/* Selected NAP Detail Panel */}
      {selectedNap && (
        <View style={styles.detailPanel}>
          <TouchableOpacity 
            style={styles.closeButton}
            onPress={() => setSelectedNap(null)}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
          
          <View style={styles.detailHeader}>
            <View style={[styles.statusDotLarge, { backgroundColor: getMarkerColor(selectedNap.vacant_lines) }]} />
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
            <InfoRow label="Status" value={selectedNap.naps_status || 'N/A'} />
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
    <Text style={[styles.portValueText, { color }]}>{value}</Text>
    <Text style={styles.portBoxLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  searchHeader: {
    backgroundColor: '#fff',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.lightGray,
    paddingHorizontal: 12,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: COLORS.dark,
  },
  clearButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.lightGray,
    justifyContent: 'center',
    alignItems: 'center',
  },
  clearButtonText: {
    fontSize: 12,
    color: COLORS.gray,
    fontWeight: 'bold',
  },
  resultsHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  resultsText: {
    fontSize: 13,
    color: COLORS.gray,
  },
  map: {
    height: 200,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 20,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGray,
  },
  resultItemActive: {
    backgroundColor: '#f0f7ff',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 12,
  },
  resultContent: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.dark,
  },
  resultSubtitle: {
    fontSize: 13,
    color: COLORS.gray,
    marginTop: 2,
  },
  resultAddress: {
    fontSize: 12,
    color: COLORS.gray,
  },
  portInfo: {
    alignItems: 'center',
    marginLeft: 12,
  },
  portValue: {
    fontSize: 22,
    fontWeight: 'bold',
  },
  portLabel: {
    fontSize: 10,
    color: COLORS.gray,
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.dark,
    marginBottom: 4,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.gray,
    textAlign: 'center',
  },
  callout: {
    padding: 8,
    minWidth: 120,
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
  statusDotLarge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
  },
  detailTitleContainer: {
    flex: 1,
  },
  detailTitle: {
    fontSize: 20,
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
  portValueText: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  portBoxLabel: {
    fontSize: 11,
    color: COLORS.gray,
    marginTop: 4,
  },
});

export default NapSearchScreen;
