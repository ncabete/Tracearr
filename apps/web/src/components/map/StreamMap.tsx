import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { ActiveSession, LocationStats } from '@tracearr/shared';
import { cn } from '@/lib/utils';

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as { _getIconUrl?: () => void })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// Custom marker icon for active sessions
const activeSessionIcon = L.divIcon({
  className: 'stream-marker',
  html: `<div class="relative">
    <div class="absolute -inset-1 animate-ping rounded-full bg-green-500/50"></div>
    <div class="relative h-4 w-4 rounded-full bg-green-500 border-2 border-white shadow-lg"></div>
  </div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
  popupAnchor: [0, -10],
});

// Location marker icon
const locationIcon = L.divIcon({
  className: 'location-marker',
  html: `<div class="h-3 w-3 rounded-full bg-blue-500 border-2 border-white shadow-md"></div>`,
  iconSize: [12, 12],
  iconAnchor: [6, 6],
  popupAnchor: [0, -8],
});

interface StreamMapProps {
  sessions?: ActiveSession[];
  locations?: LocationStats[];
  className?: string;
  height?: number | string;
}

// Component to fit bounds when data changes
function MapBoundsUpdater({
  sessions,
  locations,
}: {
  sessions?: ActiveSession[];
  locations?: LocationStats[];
}) {
  const map = useMap();

  useEffect(() => {
    const points: [number, number][] = [];

    sessions?.forEach((s) => {
      if (s.geoLat && s.geoLon) {
        points.push([s.geoLat, s.geoLon]);
      }
    });

    locations?.forEach((l) => {
      if (l.lat && l.lon) {
        points.push([l.lat, l.lon]);
      }
    });

    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 });
    }
  }, [sessions, locations, map]);

  return null;
}

export function StreamMap({
  sessions,
  locations,
  className,
  height = 300,
}: StreamMapProps) {
  const hasData =
    (sessions && sessions.some((s) => s.geoLat && s.geoLon)) ||
    (locations && locations.some((l) => l.lat && l.lon));

  return (
    <div className={cn('overflow-hidden rounded-lg', className)} style={{ height }}>
      <MapContainer
        center={[20, 0]}
        zoom={2}
        className="h-full w-full"
        scrollWheelZoom={true}
        zoomControl={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        <MapBoundsUpdater sessions={sessions} locations={locations} />

        {/* Active session markers */}
        {sessions?.map((session) => {
          if (!session.geoLat || !session.geoLon) return null;

          return (
            <Marker
              key={session.id}
              position={[session.geoLat, session.geoLon]}
              icon={activeSessionIcon}
            >
              <Popup>
                <div className="min-w-[150px]">
                  <p className="font-semibold">{session.user.username}</p>
                  <p className="text-sm text-muted-foreground">{session.mediaTitle}</p>
                  <p className="mt-1 text-xs">
                    {session.geoCity && `${session.geoCity}, `}
                    {session.geoCountry}
                  </p>
                  {session.platform && (
                    <p className="text-xs text-muted-foreground">{session.platform}</p>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* Location stats markers */}
        {locations?.map((location, idx) => {
          if (!location.lat || !location.lon) return null;

          return (
            <Marker
              key={`${location.city}-${location.country}-${idx}`}
              position={[location.lat, location.lon]}
              icon={locationIcon}
            >
              <Popup>
                <div className="min-w-[120px]">
                  <p className="font-semibold">
                    {location.city}, {location.country}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {location.count} stream{location.count !== 1 ? 's' : ''}
                  </p>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>

      {!hasData && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/50">
          <p className="text-sm text-muted-foreground">No location data available</p>
        </div>
      )}
    </div>
  );
}
