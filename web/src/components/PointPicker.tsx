/**
 * Héritage RP pick session (client.lua `pickPoint`): the satellite map with markers given by another resource
 * (hrp-admin-menu « PNJ » tab). Staff click a marker (`selectMarkers`) or a point of the map then « Valider »
 * (`pick`); the answer goes back through the `pickSessionResult` NUI callback. Escape / « Annuler » close the map
 * (App.tsx → closeZoneCreator), which answers nil.
 */

import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Check, Crosshair, MapPin, X } from 'lucide-react';
import gtaMap from '../assets/maps/gta_map.jpg';
import './ZoneCreator.css';
import './PointPicker.css';
import { IMG_HEIGHT, IMG_WIDTH, gtaToLatLng, latLngToGta } from './mapCoords';

export interface PickMarker {
  key: string;
  name: string;
  x: number;
  y: number;
  color?: string;
  /** Shown hollow (e.g. an inactive NPC). */
  dimmed?: boolean;
}

export interface PickSession {
  sessionId: string;
  title: string;
  hint?: string;
  /** A point of the map can be picked and validated. */
  pick?: boolean;
  /** Clicking a marker answers with its key. */
  selectMarkers?: boolean;
  /** Marker to centre on and highlight. */
  selectedKey?: string;
  markers: PickMarker[];
}

export type PickResult = { kind: 'marker'; key: string } | { kind: 'point'; x: number; y: number };

const GetParentResourceName = (): string =>
  window.GetParentResourceName ? window.GetParentResourceName() : 'sd-zonecreator';

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const round = (v: number) => Math.round(v * 100) / 100;

/** Markers with usable coordinates only (the session comes from another resource). */
export const validMarkers = (markers: unknown): PickMarker[] =>
  Array.isArray(markers)
    ? markers.filter(
        (m): m is PickMarker =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.key === 'string' &&
          typeof m.name === 'string' &&
          Number.isFinite(m.x) &&
          Number.isFinite(m.y)
      )
    : [];

interface Props {
  session: PickSession;
  onClose: () => void;
}

const PointPicker: React.FC<Props> = ({ session, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const candidateRef = useRef<L.Marker | null>(null);
  const playerRef = useRef<L.Marker | null>(null);
  const [candidate, setCandidate] = useState<{ x: number; y: number } | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [filter, setFilter] = useState('');
  const sentRef = useRef(false);
  const markers = validMarkers(session.markers);

  const send = (result: PickResult) => {
    if (sentRef.current) return;
    sentRef.current = true;
    fetch(`https://${GetParentResourceName()}/pickSessionResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: session.sessionId, result })
    }).catch(() => {});
  };

  // Map, once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 4,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.1,
      zoomDelta: 0.25,
      wheelPxPerZoomLevel: 120,
      preferCanvas: false
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    const bounds: L.LatLngBoundsExpression = [[0, 0], [IMG_HEIGHT, IMG_WIDTH]];
    L.imageOverlay(gtaMap, bounds).addTo(map);
    map.setMaxBounds(bounds);
    map.fitBounds(bounds);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      const gta = latLngToGta(e.latlng.lat, e.latlng.lng);
      setCursor({ x: round(gta.x), y: round(gta.y) });
    });
    if (session.pick) {
      map.on('click', (e: L.LeafletMouseEvent) => {
        const gta = latLngToGta(e.latlng.lat, e.latlng.lng);
        setCandidate({ x: round(gta.x), y: round(gta.y) });
      });
    }
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Markers (re-drawn when the filter changes)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const layer = L.layerGroup().addTo(map);
    const q = filter.trim().toLowerCase();
    for (const m of markers) {
      const selected = m.key === session.selectedKey;
      const matches = !q || m.name.toLowerCase().includes(q);
      const color = m.color && COLOR_RE.test(m.color) ? m.color : '#f59e0b';
      const marker = L.circleMarker(gtaToLatLng(m.x, m.y), {
        radius: selected ? 10 : 7,
        color: selected ? '#ffffff' : color,
        weight: selected ? 3 : 2,
        fillColor: color,
        fillOpacity: m.dimmed ? 0.1 : 0.85,
        opacity: matches ? 1 : 0.25,
        interactive: session.selectMarkers === true
      }).addTo(layer);
      marker.bindTooltip(m.name, { direction: 'top', offset: [0, -8], permanent: selected });
      if (session.selectMarkers) marker.on('click', () => send({ kind: 'marker', key: m.key }));
    }
    return () => {
      layer.remove();
    };
  }, [filter, session]);

  // First view: the selected marker, else every marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const selected = markers.find((m) => m.key === session.selectedKey);
    if (selected) map.setView(gtaToLatLng(selected.x, selected.y), 2);
    else if (markers.length > 0)
      map.fitBounds(L.latLngBounds(markers.map((m) => gtaToLatLng(m.x, m.y))), { padding: [80, 80], maxZoom: 2 });
  }, []);

  // Candidate point
  useEffect(() => {
    const map = mapRef.current;
    candidateRef.current?.remove();
    candidateRef.current = null;
    if (!map || !candidate) return;
    const icon = L.divIcon({
      className: 'pick-candidate',
      html: '<div class="pick-candidate-cross"></div>',
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    candidateRef.current = L.marker(gtaToLatLng(candidate.x, candidate.y), { icon, interactive: false }).addTo(map);
  }, [candidate]);

  // Player position (client.lua sends it every 500 ms while the map is open)
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const { action, data } = event.data ?? {};
      const map = mapRef.current;
      if (action !== 'updatePlayerPosition' || !map || !data) return;
      if (!Number.isFinite(data.x) || !Number.isFinite(data.y)) return;
      const latLng = gtaToLatLng(data.x, data.y);
      if (playerRef.current) {
        playerRef.current.setLatLng(latLng);
        return;
      }
      const icon = L.divIcon({
        className: 'player-marker',
        html: '<div class="player-marker-container"><div class="player-marker-ring"></div><div class="player-marker-inner"></div></div>',
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      playerRef.current = L.marker(latLng, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div className="pick-root">
      <header className="pick-bar">
        <div className="pick-title">
          <MapPin size={18} />
          <div>
            <strong>{session.title}</strong>
            {session.hint && <small>{session.hint}</small>}
          </div>
        </div>
        <input
          className="pick-filter"
          placeholder="Filtrer les marqueurs"
          value={filter}
          maxLength={64}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="pick-coords">
          <Crosshair size={14} /> {cursor ? `${cursor.x}, ${cursor.y}` : '—'}
        </span>
        {session.pick && (
          <button
            type="button"
            className="pick-button pick-primary"
            disabled={!candidate}
            onClick={() => candidate && send({ kind: 'point', x: candidate.x, y: candidate.y })}
          >
            <Check size={16} /> {candidate ? `Valider ${candidate.x}, ${candidate.y}` : 'Cliquez un point'}
          </button>
        )}
        <button type="button" className="pick-button" onClick={onClose}>
          <X size={16} /> Annuler
        </button>
      </header>
      <div ref={containerRef} className="pick-map" />
    </div>
  );
};

export default PointPicker;
