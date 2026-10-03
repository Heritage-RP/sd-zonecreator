import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Plus,
  Trash2,
  Copy,
  X,
  MapPin,
  Layers,
  RotateCcw,
  Redo,
  Check,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  Grid,
  Square,
  Circle,
  Upload,
  Search,
  Navigation,
  Ruler,
  ZoomIn,
  Triangle,
  Hexagon,
  Star,
  CornerDownRight,
  Octagon,
  Minimize2,
  Settings,
  Video,
  Loader2,
  Wand2
} from 'lucide-react';
import gtaMap from '../assets/maps/gta_map.jpg';
import './ZoneCreator.css';
import NumberInput from './NumberInput';
import Notification, { useNotifications } from './Notification';

const IMG_WIDTH = 4096;
const IMG_HEIGHT = 6144;
const GRID_SIZE = 10;

const GTA_BOUNDS = {
  minX: -4000,
  maxX: 4500,
  minY: -4000,
  maxY: 8000
};

const SCALE_X = 0.454685;
const SCALE_Y = -0.454830;
const OFFSET_X = 1882.72;
const OFFSET_Y = 3826.58;

export const gtaToLatLng = (gtaX: number, gtaY: number): [number, number] => {
  const lng = gtaX * SCALE_X + OFFSET_X;
  const lat = IMG_HEIGHT - (gtaY * SCALE_Y + OFFSET_Y);
  return [lat, lng];
};

export const latLngToGta = (lat: number, lng: number): { x: number; y: number } => {
  const x = (lng - OFFSET_X) / SCALE_X;
  const y = (IMG_HEIGHT - lat - OFFSET_Y) / SCALE_Y;
  return { x, y };
};

const snapToGrid = (value: number, gridSize: number): number => {
  return Math.round(value / gridSize) * gridSize;
};

const calculateDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

const GetParentResourceName = (): string => {
  if (window.GetParentResourceName) {
    return window.GetParentResourceName();
  }
  return 'sd-zonecreator';
};

interface ZonePoint {
  id: string;
  gtaCoords: { x: number; y: number; z: number | null };
  latLng: [number, number];
}

interface Zone {
  id: string;
  name: string;
  points: ZonePoint[];
  color: string;
  visible: boolean;
  thickness: number;
  fillPattern: 'solid' | 'stripes' | 'dots';
  groundZ: number | null;
  /** Héritage RP edit session: key of the zone given by the calling resource. */
  sessionKey?: string;
}

/** Héritage RP: a zone given by the resource that opened an edit session (see client.lua `editZone`). */
export interface EditSessionZone {
  key: string;
  name: string;
  points: { x: number; y: number }[];
  thickness: number;
  groundZ: number | null;
  color?: string;
}

/** Héritage RP: another resource (hrp-zones) opened the creator to edit one zone and get it back. */
export interface EditSession {
  sessionId: string;
  title: string;
  /** Key of the zone sent back on « Valider »; the other zones are only shown for reference. */
  editKey: string;
  zones: EditSessionZone[];
}

const sessionZones = (session: EditSession): Zone[] =>
  session.zones.map((z, i) => ({
    id: `session-${z.key}`,
    name: z.key === session.editKey ? z.name : `${z.name} (référence)`,
    points: z.points.map((p, j) => ({
      id: `point-${z.key}-${j}`,
      gtaCoords: { x: p.x, y: p.y, z: null },
      latLng: gtaToLatLng(p.x, p.y)
    })),
    color: z.color ?? ZONE_COLORS[i % ZONE_COLORS.length],
    visible: true,
    thickness: z.thickness,
    fillPattern: 'solid',
    groundZ: z.groundZ,
    sessionKey: z.key
  }));

interface HistoryState {
  zones: Zone[];
  activeZoneId: string | null;
}

interface ZoneCreatorProps {
  onClose: () => void;
  session?: EditSession | null;
}

const ZONE_COLORS = [
  '#22c55e', '#3b82f6', '#f59e0b', '#ef4444',
  '#06b6d4', '#ec4899', '#8b5cf6', '#a855f7',
];

const FILL_PATTERNS = ['solid', 'stripes', 'dots'] as const;

const ZoneCreator: React.FC<ZoneCreatorProps> = ({ onClose, session = null }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const polygonsRef = useRef<Map<string, L.Polygon>>(new Map());
  const polylinesRef = useRef<Map<string, L.Polyline>>(new Map());
  const distanceLabelsRef = useRef<L.Marker[]>([]);
  const previewLineRef = useRef<L.Polyline | null>(null);
  const playerMarkerRef = useRef<L.Marker | null>(null);
  const gridLayerRef = useRef<L.LayerGroup | null>(null);
  const isZoomingRef = useRef(false);

  const [zones, setZones] = useState<Zone[]>(() => (session ? sessionZones(session) : []));
  const [activeZoneId, setActiveZoneId] = useState<string | null>(() => (session ? `session-${session.editKey}` : null));
  const [isCreatingZone, setIsCreatingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [expandedZones, setExpandedZones] = useState<Set<string>>(() => new Set(session ? [`session-${session.editKey}`] : []));
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [cursorCoords, setCursorCoords] = useState<{ x: number; y: number } | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(-1);
  const [playerPosition, setPlayerPosition] = useState<{ x: number; y: number } | null>(null);
  const [initialPlayerPosition, setInitialPlayerPosition] = useState<{ x: number; y: number } | null>(null);
  const [isViewingZone, setIsViewingZone] = useState(false);
  const [viewingZoneId, setViewingZoneId] = useState<string | null>(null);
  const [fetchingZoneGroundZ, setFetchingZoneGroundZ] = useState<Set<string>>(new Set());
  const [viewerData, setViewerData] = useState<{
    groundZ: number;
    thickness: number;
  } | null>(null);

  const [snapToGridEnabled, setSnapToGridEnabled] = useState(false);
  const [showDistances, setShowDistances] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [importCode, setImportCode] = useState('');
  const [searchX, setSearchX] = useState('');
  const [searchY, setSearchY] = useState('');
  const [templateSize, setTemplateSize] = useState('50');
  const [selectedPoints, setSelectedPoints] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{ lat: number; lng: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ lat: number; lng: number } | null>(null);
  const selectionRectRef = useRef<L.Rectangle | null>(null);

  const [previewShape, setPreviewShape] = useState<{
    type: string;
    points: ZonePoint[];
    centerX: number;
    centerY: number;
    scale: number;
    rotation: number;
  } | null>(null);
  const [previewControlsHidden, setPreviewControlsHidden] = useState(false);
  const previewPolygonRef = useRef<L.Polygon | null>(null);
  const previewMarkersRef = useRef<L.CircleMarker[]>([]);
  const isDraggingPreviewRef = useRef(false);

  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isDraggingRef = useRef(false);
  const lastDragEndTimeRef = useRef(0);

  const activeZoneIdRef = useRef<string | null>(null);
  const zonesRef = useRef<Zone[]>([]);
  const snapToGridEnabledRef = useRef(false);
  const historyRef = useRef<HistoryState[]>([]);
  const historyIndexRef = useRef(-1);

  const historyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HISTORY_DEBOUNCE_MS = 500;

  const previewShapeRef = useRef<typeof previewShape>(null);

  const { notifications, notify, dismissNotification } = useNotifications();

  useEffect(() => { activeZoneIdRef.current = activeZoneId; }, [activeZoneId]);
  useEffect(() => { zonesRef.current = zones; }, [zones]);
  useEffect(() => { snapToGridEnabledRef.current = snapToGridEnabled; }, [snapToGridEnabled]);
  useEffect(() => { previewShapeRef.current = previewShape; }, [previewShape]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  useEffect(() => {
    return () => {
      if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    };
  }, []);

  const activeZone = zones.find(z => z.id === activeZoneId);

  const saveToHistory = useCallback((newZones: Zone[], newActiveId: string | null, immediate: boolean = false) => {
    const doSave = () => {
      const newState: HistoryState = { zones: JSON.parse(JSON.stringify(zonesRef.current)), activeZoneId: activeZoneIdRef.current };
      const currentIndex = historyIndexRef.current;
      setHistory(prev => {
        const newHistory = prev.slice(0, currentIndex + 1);
        return [...newHistory, newState];
      });
      setHistoryIndex(currentIndex + 1);
    };

    if (immediate) {
      if (historyDebounceRef.current) {
        clearTimeout(historyDebounceRef.current);
        historyDebounceRef.current = null;
      }
      doSave();
      return;
    }

    if (historyDebounceRef.current) {
      clearTimeout(historyDebounceRef.current);
    }
    historyDebounceRef.current = setTimeout(() => {
      doSave();
      historyDebounceRef.current = null;
    }, HISTORY_DEBOUNCE_MS);
  }, []);

  const handleUndo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const currentHistory = historyRef.current;
    if (currentIndex > 0 && currentHistory[currentIndex - 1]) {
      const prevState = currentHistory[currentIndex - 1];
      setZones(prevState.zones);
      setActiveZoneId(prevState.activeZoneId);
      setHistoryIndex(currentIndex - 1);
    }
  }, []);

  const handleRedo = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    const currentHistory = historyRef.current;
    if (currentIndex < currentHistory.length - 1 && currentHistory[currentIndex + 1]) {
      const nextState = currentHistory[currentIndex + 1];
      setZones(nextState.zones);
      setActiveZoneId(nextState.activeZoneId);
      setHistoryIndex(currentIndex + 1);
    }
  }, []);

  const updateZonesWithHistory = useCallback((updater: (prev: Zone[]) => Zone[]) => {
    setZones(prev => {
      const newZones = updater(prev);
      saveToHistory(newZones, activeZoneId);
      return newZones;
    });
  }, [activeZoneId, saveToHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          handleRedo();
        } else if (e.key === 'f') {
          e.preventDefault();
          setShowSearchModal(true);
        }
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeZoneId) {
          updateZonesWithHistory(prev => prev.map(zone => {
            if (zone.id === activeZoneId && zone.points.length > 0) {
              return { ...zone, points: zone.points.slice(0, -1) };
            }
            return zone;
          }));
        }
      } else if (e.key === 'g') {
        setSnapToGridEnabled(prev => !prev);
      } else if (e.key === 'd') {
        setShowDistances(prev => !prev);
      } else if (e.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, activeZoneId, updateZonesWithHistory]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { action, data } = event.data;
      if (action === 'updatePlayerPosition' && data) {
        setPlayerPosition({ x: data.x, y: data.y });
        setInitialPlayerPosition(prev => prev === null ? { x: data.x, y: data.y } : prev);
      } else if (action === 'zoneViewerStarted') {
        setIsViewingZone(true);
        if (data) {
          setViewerData({
            groundZ: data.groundZ ?? 0,
            thickness: data.thickness ?? 150
          });
        }
      } else if (action === 'zoneViewerUpdate' && data) {
        setViewerData({
          groundZ: data.groundZ ?? 0,
          thickness: data.thickness ?? 4
        });
      } else if (action === 'zoneViewerStopped') {
        setIsViewingZone(false);
        setViewerData(null);
        if (data && viewingZoneId) {
          const zoneId = viewingZoneId;
          const newThickness = data.thickness;
          const currentZone = zonesRef.current.find(z => z.id === zoneId);
          if (currentZone && newThickness !== undefined && newThickness !== currentZone.thickness) {
            const newZones = zonesRef.current.map(zone => {
              if (zone.id === zoneId) {
                return { ...zone, thickness: newThickness };
              }
              return zone;
            });
            setZones(newZones);
            saveToHistory(newZones, activeZoneIdRef.current, true);
          }
        }
        setViewingZoneId(null);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [viewingZoneId, saveToHistory]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (playerMarkerRef.current) {
      playerMarkerRef.current.remove();
      playerMarkerRef.current = null;
    }

    if (initialPlayerPosition) {
      const latLng = gtaToLatLng(initialPlayerPosition.x, initialPlayerPosition.y);
      const icon = L.divIcon({
        className: 'player-marker',
        html: `
          <div class="player-marker-container">
            <div class="player-marker-ring"></div>
            <div class="player-marker-inner"></div>
          </div>
        `,
        iconSize: [36, 36],
        iconAnchor: [18, 18]
      });
      playerMarkerRef.current = L.marker(latLng, { icon, zIndexOffset: 1000, interactive: false }).addTo(map);
    }
  }, [initialPlayerPosition]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (gridLayerRef.current) {
      gridLayerRef.current.remove();
      gridLayerRef.current = null;
    }

    if (snapToGridEnabled) {
      const gridGroup = L.layerGroup();
      const gridSpacingGta = GRID_SIZE;

      const startX = Math.floor(GTA_BOUNDS.minX / gridSpacingGta) * gridSpacingGta;
      const endX = Math.ceil(GTA_BOUNDS.maxX / gridSpacingGta) * gridSpacingGta;
      const startY = Math.floor(GTA_BOUNDS.minY / gridSpacingGta) * gridSpacingGta;
      const endY = Math.ceil(GTA_BOUNDS.maxY / gridSpacingGta) * gridSpacingGta;

      const majorGridSpacing = gridSpacingGta * 5;

      for (let x = startX; x <= endX; x += majorGridSpacing) {
        const startLatLng = gtaToLatLng(x, GTA_BOUNDS.minY);
        const endLatLng = gtaToLatLng(x, GTA_BOUNDS.maxY);
        L.polyline([startLatLng, endLatLng], {
          color: '#22c55e',
          weight: 2,
          opacity: 0.5,
          interactive: false
        }).addTo(gridGroup);
      }

      for (let y = startY; y <= endY; y += majorGridSpacing) {
        const startLatLng = gtaToLatLng(GTA_BOUNDS.minX, y);
        const endLatLng = gtaToLatLng(GTA_BOUNDS.maxX, y);
        L.polyline([startLatLng, endLatLng], {
          color: '#22c55e',
          weight: 2,
          opacity: 0.5,
          interactive: false
        }).addTo(gridGroup);
      }

      gridGroup.addTo(map);
      gridLayerRef.current = gridGroup;
    }
  }, [snapToGridEnabled]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const canvasRenderer = L.canvas({ padding: 0.5, tolerance: 10 });

    const map = L.map(mapContainerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -2,
      maxZoom: 4,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.1,
      zoomDelta: 0.15,
      wheelPxPerZoomLevel: 120,
      wheelDebounceTime: 40,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
      inertiaDeceleration: 3000,
      inertiaMaxSpeed: 2000,
      easeLinearity: 0.25,
      maxBoundsViscosity: 0.8,
      keyboard: true,
      keyboardPanDelta: 80,
      preferCanvas: true,
      renderer: canvasRenderer
    });

    L.control.zoom({ position: 'topright' }).addTo(map);

    const bounds: L.LatLngBoundsExpression = [[0, 0], [IMG_HEIGHT, IMG_WIDTH]];
    L.imageOverlay(gtaMap, bounds).addTo(map);
    map.fitBounds(bounds);
    map.setZoom(-1);
    map.setMaxBounds(bounds);

    map.on('zoomstart', () => {
      isZoomingRef.current = true;
    });

    map.on('zoomend', () => {
      isZoomingRef.current = false;
      setZoomLevel(Math.round(map.getZoom() * 100) / 100);
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      let gta = latLngToGta(e.latlng.lat, e.latlng.lng);
      if (snapToGridEnabledRef.current) {
        gta = { x: snapToGrid(gta.x, GRID_SIZE), y: snapToGrid(gta.y, GRID_SIZE) };
      }
      const roundedX = Math.round(gta.x * 100) / 100;
      const roundedY = Math.round(gta.y * 100) / 100;

      setCursorCoords({ x: roundedX, y: roundedY });

      if (activeZoneIdRef.current && previewLineRef.current) {
        const activeZ = zonesRef.current.find(z => z.id === activeZoneIdRef.current);
        if (activeZ && activeZ.points.length > 0) {
          const lastPoint = activeZ.points[activeZ.points.length - 1];
          previewLineRef.current.setLatLngs([lastPoint.latLng, [e.latlng.lat, e.latlng.lng]]);
        }
      }
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      if (!activeZoneIdRef.current || isDraggingRef.current) return;
      if (Date.now() - lastDragEndTimeRef.current < 300) return;
      if (previewShapeRef.current || isDraggingPreviewRef.current) return;

      let gta = latLngToGta(e.latlng.lat, e.latlng.lng);
      if (snapToGridEnabledRef.current) {
        gta = { x: snapToGrid(gta.x, GRID_SIZE), y: snapToGrid(gta.y, GRID_SIZE) };
      }

      const latLng = snapToGridEnabledRef.current ? gtaToLatLng(gta.x, gta.y) : [e.latlng.lat, e.latlng.lng] as [number, number];

      const pointX = Math.round(gta.x * 100) / 100;
      const pointY = Math.round(gta.y * 100) / 100;
      const pointId = `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const newPoint: ZonePoint = {
        id: pointId,
        gtaCoords: { x: pointX, y: pointY, z: null },
        latLng
      };

      const currentActiveId = activeZoneIdRef.current;
      setZones(prev => {
        const newZones = prev.map(zone => {
          if (zone.id === currentActiveId) {
            return { ...zone, points: [...zone.points, newPoint] };
          }
          return zone;
        });
        saveToHistory(newZones, currentActiveId);
        return newZones;
      });
    });

    map.on('mousedown', (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey && activeZoneIdRef.current) {
        map.dragging.disable();
        setIsSelecting(true);
        setSelectionStart({ lat: e.latlng.lat, lng: e.latlng.lng });
        setSelectionEnd({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (e.originalEvent.shiftKey && selectionRectRef.current) {
        setSelectionEnd({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    map.on('mouseup', (e: L.LeafletMouseEvent) => {
      map.dragging.enable();
      setIsSelecting(false);
    });

    mapRef.current = map;
    setZoomLevel(map.getZoom());

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Héritage RP edit session: start on the edited zone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !session) return;
    const edited = session.zones.find(z => z.key === session.editKey);
    const all = (edited && edited.points.length > 0 ? [edited] : session.zones).flatMap(z => z.points);
    if (all.length === 0) return;
    map.fitBounds(L.latLngBounds(all.map(p => gtaToLatLng(p.x, p.y))), { padding: [80, 80], maxZoom: 2 });
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (previewLineRef.current) {
      previewLineRef.current.remove();
      previewLineRef.current = null;
    }

    if (activeZone && activeZone.points.length > 0) {
      previewLineRef.current = L.polyline([], {
        color: activeZone.color,
        weight: 2,
        dashArray: '5, 10',
        opacity: 0.6
      }).addTo(map);
    }
  }, [activeZone?.id, activeZone?.points.length, activeZone?.color]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (selectionRectRef.current) {
      selectionRectRef.current.remove();
      selectionRectRef.current = null;
    }

    if (isSelecting && selectionStart && selectionEnd) {
      const bounds: L.LatLngBoundsExpression = [
        [Math.min(selectionStart.lat, selectionEnd.lat), Math.min(selectionStart.lng, selectionEnd.lng)],
        [Math.max(selectionStart.lat, selectionEnd.lat), Math.max(selectionStart.lng, selectionEnd.lng)]
      ];

      selectionRectRef.current = L.rectangle(bounds, {
        color: '#22c55e',
        weight: 2,
        fillColor: '#22c55e',
        fillOpacity: 0.1,
        dashArray: '5, 5'
      }).addTo(map);

      if (activeZone) {
        const newSelection = new Set<string>();
        activeZone.points.forEach(point => {
          const lat = point.latLng[0];
          const lng = point.latLng[1];
          const minLat = Math.min(selectionStart.lat, selectionEnd.lat);
          const maxLat = Math.max(selectionStart.lat, selectionEnd.lat);
          const minLng = Math.min(selectionStart.lng, selectionEnd.lng);
          const maxLng = Math.max(selectionStart.lng, selectionEnd.lng);

          if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
            newSelection.add(point.id);
          }
        });
        setSelectedPoints(newSelection);
      }
    } else if (!isSelecting) {
      setSelectionStart(null);
      setSelectionEnd(null);
    }
  }, [isSelecting, selectionStart, selectionEnd, activeZone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (previewPolygonRef.current) {
      previewPolygonRef.current.remove();
      previewPolygonRef.current = null;
    }
    previewMarkersRef.current.forEach(m => m.remove());
    previewMarkersRef.current = [];

    if (previewShape) {
      const latLngs = previewShape.points.map(p => p.latLng);

      previewPolygonRef.current = L.polygon(latLngs, {
        color: '#22c55e',
        fillColor: '#22c55e',
        fillOpacity: 0.3,
        weight: 3,
        dashArray: '10, 5'
      }).addTo(map);

      const centerLatLng = gtaToLatLng(previewShape.centerX, previewShape.centerY);
      const centerMarker = L.circleMarker(centerLatLng, {
        radius: 12,
        fillColor: '#22c55e',
        color: '#ffffff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
        className: 'preview-center-marker'
      }).addTo(map);

      centerMarker.on('mousedown', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e.originalEvent);
        L.DomEvent.preventDefault(e.originalEvent);
        isDraggingPreviewRef.current = true;
        map.dragging.disable();
        centerMarker.closeTooltip();

        const onMouseMove = (moveE: L.LeafletMouseEvent) => {
          if (!isDraggingPreviewRef.current) return;
          const gta = latLngToGta(moveE.latlng.lat, moveE.latlng.lng);
          updatePreviewPosition(Math.round(gta.x), Math.round(gta.y));
        };

        const onMouseUp = (upE: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(upE.originalEvent);
          isDraggingPreviewRef.current = false;
          lastDragEndTimeRef.current = Date.now();
          map.dragging.enable();
          map.off('mousemove', onMouseMove);
          map.off('mouseup', onMouseUp);
        };

        map.on('mousemove', onMouseMove);
        map.on('mouseup', onMouseUp);
      });

      centerMarker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e.originalEvent);
        L.DomEvent.preventDefault(e.originalEvent);
      });

      centerMarker.on('tooltipopen', () => {
        if (isDraggingPreviewRef.current) {
          centerMarker.closeTooltip();
        }
      });

      centerMarker.bindTooltip('Drag to move', { direction: 'top', offset: [0, -15] });
      previewMarkersRef.current.push(centerMarker);

      previewShape.points.forEach((point, idx) => {
        const marker = L.circleMarker(point.latLng, {
          radius: 6,
          fillColor: '#22c55e',
          color: '#22c55e',
          weight: 2,
          opacity: 0.8,
          fillOpacity: 0.6
        }).addTo(map);
        previewMarkersRef.current.push(marker);
      });
    }
  }, [previewShape]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    markersRef.current.forEach(marker => marker.remove());
    markersRef.current.clear();
    polygonsRef.current.forEach(polygon => polygon.remove());
    polygonsRef.current.clear();
    polylinesRef.current.forEach(polyline => polyline.remove());
    polylinesRef.current.clear();
    distanceLabelsRef.current.forEach(label => label.remove());
    distanceLabelsRef.current = [];

    zones.forEach(zone => {
      if (!zone.visible) return;

      const isActive = zone.id === activeZoneId;
      const color = zone.color;

      zone.points.forEach((point, index) => {
        const markerSize = isActive ? 28 : 22;
        const markerIcon = L.divIcon({
          className: `zone-point-marker ${isActive ? 'active' : ''} ${selectedPoints.has(point.id) ? 'selected' : ''}`,
          html: `<div class="zone-point-inner" style="background: ${color}; border-color: ${isActive ? '#ffffff' : color}">${index + 1}</div>`,
          iconSize: [markerSize, markerSize],
          iconAnchor: [markerSize / 2, markerSize / 2]
        });
        const marker = L.marker(point.latLng, {
          icon: markerIcon,
          interactive: true,
          bubblingMouseEvents: false
        }).addTo(map);

        const zDisplay = point.gtaCoords.z !== null ? point.gtaCoords.z : '...';
        marker.bindTooltip(`
          <div class="point-tooltip-content">
            <div class="point-tooltip-header">Point ${index + 1}</div>
            <div class="point-tooltip-coords">X: ${point.gtaCoords.x}</div>
            <div class="point-tooltip-coords">Y: ${point.gtaCoords.y}</div>
            <div class="point-tooltip-coords">Z: ${zDisplay}</div>
            ${isActive ? '<div class="point-tooltip-hint">Drag to move • Right-click to delete</div>' : ''}
          </div>
        `, {
          direction: 'top',
          offset: [0, -12],
          className: 'zone-point-tooltip-enhanced'
        });

        if (isActive) {
          let isDraggingPoint = false;
          let lastDragX = 0;
          let lastDragY = 0;

          marker.on('mousedown', (e: L.LeafletMouseEvent) => {
            L.DomEvent.stopPropagation(e.originalEvent);
            L.DomEvent.preventDefault(e.originalEvent);

            isDraggingPoint = true;
            isDraggingRef.current = true;
            map.dragging.disable();

            const onMouseMove = (moveEvent: L.LeafletMouseEvent) => {
              if (!isDraggingPoint) return;

              let gta = latLngToGta(moveEvent.latlng.lat, moveEvent.latlng.lng);
              if (snapToGridEnabledRef.current) {
                gta = { x: snapToGrid(gta.x, GRID_SIZE), y: snapToGrid(gta.y, GRID_SIZE) };
              }
              const newLatLng = snapToGridEnabledRef.current ? gtaToLatLng(gta.x, gta.y) : [moveEvent.latlng.lat, moveEvent.latlng.lng] as [number, number];

              lastDragX = Math.round(gta.x * 100) / 100;
              lastDragY = Math.round(gta.y * 100) / 100;

              marker.setLatLng(newLatLng);

              setZones(prev => prev.map(z => {
                if (z.id === zone.id) {
                  return {
                    ...z,
                    points: z.points.map(p => p.id === point.id ? {
                      ...p,
                      gtaCoords: { x: lastDragX, y: lastDragY, z: null },
                      latLng: newLatLng
                    } : p)
                  };
                }
                return z;
              }));
            };

            const onMouseUp = () => {
              isDraggingPoint = false;
              lastDragEndTimeRef.current = Date.now();
              setTimeout(() => { isDraggingRef.current = false; }, 100);
              map.dragging.enable();
              map.off('mousemove', onMouseMove);
              map.off('mouseup', onMouseUp);
              saveToHistory(zonesRef.current, activeZoneIdRef.current);
            };

            map.on('mousemove', onMouseMove);
            map.on('mouseup', onMouseUp);
          });
        }

        marker.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e.originalEvent);
          L.DomEvent.preventDefault(e.originalEvent);
        });

        marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          e.originalEvent.preventDefault();
          if (isActive) {
            updateZonesWithHistory(prev => prev.map(z => {
              if (z.id === zone.id) {
                return { ...z, points: z.points.filter(p => p.id !== point.id) };
              }
              return z;
            }));
          }
        });

        markersRef.current.set(point.id, marker);
      });

      if (showDistances && zone.points.length >= 2) {
        for (let i = 0; i < zone.points.length; i++) {
          const p1 = zone.points[i];
          const p2 = zone.points[(i + 1) % zone.points.length];
          const distance = calculateDistance(p1.gtaCoords, p2.gtaCoords);
          const midLat = (p1.latLng[0] + p2.latLng[0]) / 2;
          const midLng = (p1.latLng[1] + p2.latLng[1]) / 2;

          const distLabel = L.divIcon({
            className: 'distance-label',
            html: `<span>${distance.toFixed(1)}m</span>`,
            iconSize: [50, 20],
            iconAnchor: [25, 10]
          });
          const labelMarker = L.marker([midLat, midLng], { icon: distLabel, interactive: false }).addTo(map);
          distanceLabelsRef.current.push(labelMarker);
        }
      }

      if (zone.points.length >= 3) {
        const latLngs = zone.points.map(p => p.latLng);
        let fillPattern: L.PathOptions = { fillColor: color, fillOpacity: isActive ? 0.35 : 0.25 };

        const polygon = L.polygon(latLngs, {
          color: color,
          ...fillPattern,
          weight: isActive ? 3 : 2,
          dashArray: isActive ? undefined : '5, 5'
        }).addTo(map);

        polygon.on('click', (e: L.LeafletMouseEvent) => {
          if (!isActive) return;
          L.DomEvent.stopPropagation(e);

          // Find closest edge
          let minDist = Infinity;
          let insertIndex = 0;
          const clickLatLng = e.latlng;

          for (let i = 0; i < zone.points.length; i++) {
            const p1 = zone.points[i];
            const p2 = zone.points[(i + 1) % zone.points.length];
            const midLat = (p1.latLng[0] + p2.latLng[0]) / 2;
            const midLng = (p1.latLng[1] + p2.latLng[1]) / 2;
            const dist = Math.sqrt(Math.pow(clickLatLng.lat - midLat, 2) + Math.pow(clickLatLng.lng - midLng, 2));
            if (dist < minDist) {
              minDist = dist;
              insertIndex = i + 1;
            }
          }

          let gta = latLngToGta(clickLatLng.lat, clickLatLng.lng);
          if (snapToGridEnabled) {
            gta = { x: snapToGrid(gta.x, GRID_SIZE), y: snapToGrid(gta.y, GRID_SIZE) };
          }

          const pointX = Math.round(gta.x * 100) / 100;
          const pointY = Math.round(gta.y * 100) / 100;
          const pointId = `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          const newPoint: ZonePoint = {
            id: pointId,
            gtaCoords: { x: pointX, y: pointY, z: null },
            latLng: snapToGridEnabled ? gtaToLatLng(gta.x, gta.y) : [clickLatLng.lat, clickLatLng.lng]
          };

          updateZonesWithHistory(prev => prev.map(z => {
            if (z.id === zone.id) {
              const newPoints = [...z.points];
              newPoints.splice(insertIndex, 0, newPoint);
              return { ...z, points: newPoints };
            }
            return z;
          }));
        });

        polygonsRef.current.set(zone.id, polygon);
      } else if (zone.points.length === 2) {
        const latLngs = zone.points.map(p => p.latLng);
        const polyline = L.polyline(latLngs, {
          color: color,
          weight: isActive ? 3 : 2,
          dashArray: '5, 5'
        }).addTo(map);
        polylinesRef.current.set(zone.id, polyline);
      }
    });
  }, [zones, activeZoneId, showDistances, snapToGridEnabled, saveToHistory]);

  // Create new zone
  const handleCreateZone = () => {
    if (!newZoneName.trim()) return;
    const zoneName = newZoneName.trim();
    const newZone: Zone = {
      id: `zone-${Date.now()}`,
      name: zoneName,
      points: [],
      color: ZONE_COLORS[zones.length % ZONE_COLORS.length],
      visible: true,
      thickness: 150,
      fillPattern: 'solid',
      groundZ: null
    };
    const newZones = [...zones, newZone];
    setZones(newZones);
    setActiveZoneId(newZone.id);
    setExpandedZones(prev => new Set([...prev, newZone.id]));
    saveToHistory(newZones, newZone.id, true);
    setNewZoneName('');
    setIsCreatingZone(false);
    notify.success(`Created zone "${zoneName}"`);
  };

  // Delete zone
  const handleDeleteZone = (zoneId: string) => {
    const deletedZone = zones.find(z => z.id === zoneId);
    const newZones = zones.filter(z => z.id !== zoneId);
    setZones(newZones);
    saveToHistory(newZones, activeZoneId === zoneId ? null : activeZoneId, true);
    if (activeZoneId === zoneId) setActiveZoneId(null);
    if (deletedZone) {
      notify.info(`Deleted zone "${deletedZone.name}"`);
    }
  };

  // Toggle zone visibility
  const handleToggleVisibility = (zoneId: string) => {
    setZones(prev => prev.map(zone => zone.id === zoneId ? { ...zone, visible: !zone.visible } : zone));
  };

  // Update thickness
  const handleUpdateZoneThickness = (zoneId: string, value: number) => {
    updateZonesWithHistory(prev => prev.map(zone => zone.id === zoneId ? { ...zone, thickness: value } : zone));
  };

  const handleCalculateGroundZ = async (zoneId: string) => {
    const zone = zones.find(z => z.id === zoneId);
    if (!zone || zone.points.length === 0) return;

    setFetchingZoneGroundZ(prev => new Set([...prev, zoneId]));

    try {
      const sumX = zone.points.reduce((sum, p) => sum + p.gtaCoords.x, 0);
      const sumY = zone.points.reduce((sum, p) => sum + p.gtaCoords.y, 0);
      const centerX = sumX / zone.points.length;
      const centerY = sumY / zone.points.length;

      const response = await fetch(`https://${window.GetParentResourceName?.() || 'sd-zonecreator'}/getPointZ`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: centerX, y: centerY })
      });
      const result = await response.json();

      if (result.z !== null && result.z !== undefined) {
        const groundZ = Math.round(result.z * 100) / 100;

        updateZonesWithHistory(prev => prev.map(z => {
          if (z.id === zoneId) {
            return {
              ...z,
              groundZ,
              points: z.points.map(p => ({
                ...p,
                gtaCoords: { ...p.gtaCoords, z: groundZ }
              }))
            };
          }
          return z;
        }));

        notify.success(`Ground Z calculated: ${groundZ}`);
      } else {
        notify.error('Could not get ground Z at this location');
      }
    } catch (error) {
      console.error('Failed to calculate ground Z:', error);
      notify.error('Failed to calculate ground Z');
    } finally {
      // Remove from fetching set
      setFetchingZoneGroundZ(prev => {
        const next = new Set(prev);
        next.delete(zoneId);
        return next;
      });
    }
  };

  // Generate code
  const generatePolyzoneCode = (zone: Zone): string => {
    if (zone.points.length < 3) return '-- Need at least 3 points';
    const pointsStr = zone.points.map(p => `    vector2(${p.gtaCoords.x}, ${p.gtaCoords.y})`).join(',\n');
    // For PolyZone, calculate minZ/maxZ from groundZ and thickness
    const baseZ = zone.groundZ !== null ? zone.groundZ : 0;
    const minZ = baseZ;
    const maxZ = baseZ + zone.thickness;
    return `local ${zone.name.replace(/\s+/g, '_')} = PolyZone:Create({\n${pointsStr}\n}, {\n    name = "${zone.name}",\n    minZ = ${minZ},\n    maxZ = ${maxZ}\n})`;
  };

  const generateOxLibCode = (zone: Zone): string => {
    if (zone.points.length < 3) return '-- Need at least 3 points';
    // Use groundZ if calculated, otherwise 0.0
    const baseZ = zone.groundZ !== null ? zone.groundZ : 0.0;
    const pointsStr = zone.points.map(p => `        vec3(${p.gtaCoords.x}, ${p.gtaCoords.y}, ${baseZ})`).join(',\n');
    return `lib.zones.poly({\n    name = '${zone.name.replace(/\s+/g, '_')}',\n    points = {\n${pointsStr}\n    },\n    thickness = ${zone.thickness},\n    debug = true\n})`;
  };

  const generateCoordsVec2 = (zone: Zone): string => {
    if (zone.points.length === 0) return '-- No points';
    return zone.points.map(p => `vector2(${p.gtaCoords.x}, ${p.gtaCoords.y})`).join(',\n');
  };

  const generateCoordsVec3 = (zone: Zone): string => {
    if (zone.points.length === 0) return '-- No points';
    // Use groundZ for all points if available, otherwise use individual point Z or 0
    const baseZ = zone.groundZ;
    return zone.points.map(p => {
      const z = baseZ !== null ? baseZ : (p.gtaCoords.z !== null ? p.gtaCoords.z : 0);
      return `vector3(${p.gtaCoords.x}, ${p.gtaCoords.y}, ${z})`;
    }).join(',\n');
  };

  // Copy to clipboard using execCommand (works in FiveM NUI)
  const copyToClipboard = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    try {
      document.execCommand('copy');
    } catch (err) {
      console.error('Failed to copy:', err);
    }

    document.body.removeChild(textarea);
  };

  // View zone in 3D
  const handleViewZone = (zone: Zone) => {
    if (zone.points.length < 3) return;

    setViewingZoneId(zone.id);
    const points = zone.points.map(p => ({ x: p.gtaCoords.x, y: p.gtaCoords.y }));

    fetch(`https://${GetParentResourceName()}/viewZone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points,
        groundZ: zone.groundZ ?? 0,
        thickness: zone.thickness,
        zoneName: zone.name
      })
    }).catch(() => {});
  };

  const handleCopyCode = (zone: Zone, format: 'polyzone' | 'oxlib' | 'vec2' | 'vec3') => {
    let code: string;
    let formatName: string;
    if (format === 'polyzone') {
      code = generatePolyzoneCode(zone);
      formatName = 'PolyZone';
    } else if (format === 'oxlib') {
      code = generateOxLibCode(zone);
      formatName = 'ox_lib';
    } else if (format === 'vec3') {
      code = generateCoordsVec3(zone);
      formatName = 'vector3';
    } else {
      code = generateCoordsVec2(zone);
      formatName = 'vector2';
    }

    copyToClipboard(code);
    notify.success(`Copied "${zone.name}" ${formatName} data to clipboard`);
  };

  // Import zone from code
  const handleImportZone = () => {
    try {
      const points: ZonePoint[] = [];
      let extractedZ: number | null = null;

      const vectorMatches = importCode.matchAll(/vec(?:tor)?([23])\s*\(\s*([-\d.]+)\s*,\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)/gi);
      for (const match of vectorMatches) {
        const x = parseFloat(match[2]);
        const y = parseFloat(match[3]);
        const z = match[4] ? parseFloat(match[4]) : null;
        if (z !== null && extractedZ === null) {
          extractedZ = z;
        }
        points.push({
          id: `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          gtaCoords: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z },
          latLng: gtaToLatLng(x, y)
        });
      }

      if (points.length === 0) {
        const plainMatches = importCode.matchAll(/(?:^|[{\s,])(\s*-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)(?:\s*[,\s]\s*(-?\d+\.?\d*))?(?:[}\s,]|$)/gm);
        for (const match of plainMatches) {
          const x = parseFloat(match[1]);
          const y = parseFloat(match[2]);
          const z = match[3] ? parseFloat(match[3]) : null;
          if (!isNaN(x) && !isNaN(y)) {
            if (z !== null && extractedZ === null) {
              extractedZ = z;
            }
            points.push({
              id: `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              gtaCoords: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z },
              latLng: gtaToLatLng(x, y)
            });
          }
        }
      }

      if (points.length === 0) {
        const tableMatches = importCode.matchAll(/\{\s*x\s*=\s*([-\d.]+)\s*,\s*y\s*=\s*([-\d.]+)(?:\s*,\s*z\s*=\s*([-\d.]+))?\s*\}/gi);
        for (const match of tableMatches) {
          const x = parseFloat(match[1]);
          const y = parseFloat(match[2]);
          const z = match[3] ? parseFloat(match[3]) : null;
          if (z !== null && extractedZ === null) {
            extractedZ = z;
          }
          points.push({
            id: `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            gtaCoords: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z },
            latLng: gtaToLatLng(x, y)
          });
        }
      }

      if (points.length < 3) {
        alert('Could not parse coordinates. Need at least 3 points.\n\nSupported formats:\n- vector2(x, y) or vec2(x, y)\n- vector3(x, y, z) or vec3(x, y, z)\n- {x = 100, y = 200}\n- Plain numbers: 100, 200');
        return;
      }

      // Extract name if available
      const nameMatch = importCode.match(/name\s*=\s*['"]([^'"]+)['"]/);
      const name = nameMatch ? nameMatch[1] : `Imported Zone ${zones.length + 1}`;

      // Extract thickness
      const thicknessMatch = importCode.match(/thickness\s*=\s*([-\d.]+)/);
      const minZMatch = importCode.match(/minZ\s*=\s*([-\d.]+)/);
      const maxZMatch = importCode.match(/maxZ\s*=\s*([-\d.]+)/);

      let thickness = 200;
      if (thicknessMatch) {
        thickness = parseFloat(thicknessMatch[1]);
      } else if (minZMatch && maxZMatch) {
        thickness = parseFloat(maxZMatch[1]) - parseFloat(minZMatch[1]);
      }

      const newZone: Zone = {
        id: `zone-${Date.now()}`,
        name,
        points,
        color: ZONE_COLORS[zones.length % ZONE_COLORS.length],
        visible: true,
        thickness,
        fillPattern: 'solid',
        groundZ: extractedZ
      };

      const newZones = [...zones, newZone];
      setZones(newZones);
      setActiveZoneId(newZone.id);
      setExpandedZones(prev => new Set([...prev, newZone.id]));
      saveToHistory(newZones, newZone.id, true);

      setShowImportModal(false);
      setImportCode('');
      notify.success(`Imported zone "${name}" with ${points.length} points`);

      // Pan to imported zone
      if (mapRef.current && points.length > 0) {
        mapRef.current.setView(points[0].latLng, 0, { animate: true });
      }
    } catch (e) {
      notify.error('Failed to parse zone code');
    }
  };

  // Search/jump to location
  const handleSearchLocation = () => {
    const x = parseFloat(searchX);
    const y = parseFloat(searchY);
    if (isNaN(x) || isNaN(y)) return;

    const latLng = gtaToLatLng(x, y);
    mapRef.current?.setView(latLng, 1, { animate: true });
    setShowSearchModal(false);
    setSearchX('');
    setSearchY('');
  };

  // Delete selected points
  const handleDeleteSelectedPoints = () => {
    if (selectedPoints.size === 0 || !activeZoneId) return;
    updateZonesWithHistory(prev => prev.map(zone => {
      if (zone.id === activeZoneId) {
        return { ...zone, points: zone.points.filter(p => !selectedPoints.has(p.id)) };
      }
      return zone;
    }));
    setSelectedPoints(new Set());
  };

  // Generate shape points helper with rotation support
  const generateShapePoints = (type: string, centerX: number, centerY: number, size: number, rotation: number = 0): ZonePoint[] => {
    const rotationRad = (rotation * Math.PI) / 180;

    // Helper to create a point with rotation applied
    const createRotatedPoint = (offsetX: number, offsetY: number) => {
      const rotatedX = offsetX * Math.cos(rotationRad) - offsetY * Math.sin(rotationRad);
      const rotatedY = offsetX * Math.sin(rotationRad) + offsetY * Math.cos(rotationRad);
      const finalX = centerX + rotatedX;
      const finalY = centerY + rotatedY;
      return {
        id: `point-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        gtaCoords: { x: Math.round(finalX * 100) / 100, y: Math.round(finalY * 100) / 100, z: null },
        latLng: gtaToLatLng(finalX, finalY)
      };
    };

    let points: ZonePoint[] = [];

    if (type === 'rectangle') {
      points = [
        createRotatedPoint(-size, -size),
        createRotatedPoint(size, -size),
        createRotatedPoint(size, size),
        createRotatedPoint(-size, size),
      ];
    } else if (type === 'circle') {
      const numPoints = 16;
      for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        points.push(createRotatedPoint(size * Math.cos(angle), size * Math.sin(angle)));
      }
    } else if (type === 'triangle') {
      for (let i = 0; i < 3; i++) {
        const angle = (i / 3) * 2 * Math.PI - Math.PI / 2;
        points.push(createRotatedPoint(size * Math.cos(angle), size * Math.sin(angle)));
      }
    } else if (type === 'pentagon') {
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * 2 * Math.PI - Math.PI / 2;
        points.push(createRotatedPoint(size * Math.cos(angle), size * Math.sin(angle)));
      }
    } else if (type === 'hexagon') {
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * 2 * Math.PI;
        points.push(createRotatedPoint(size * Math.cos(angle), size * Math.sin(angle)));
      }
    } else if (type === 'star') {
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * 2 * Math.PI - Math.PI / 2;
        const r = i % 2 === 0 ? size : size * 0.5;
        points.push(createRotatedPoint(r * Math.cos(angle), r * Math.sin(angle)));
      }
    } else if (type === 'l-shape') {
      points = [
        createRotatedPoint(-size, -size),
        createRotatedPoint(0, -size),
        createRotatedPoint(0, 0),
        createRotatedPoint(size, 0),
        createRotatedPoint(size, size),
        createRotatedPoint(-size, size),
      ];
    }

    return points;
  };

  // Start shape preview (instead of immediately creating)
  const handleCreateTemplate = (type: 'rectangle' | 'circle' | 'triangle' | 'pentagon' | 'hexagon' | 'star' | 'l-shape') => {
    const size = parseFloat(templateSize) || 50;

    const map = mapRef.current;
    let centerX = 0, centerY = 0;
    if (map) {
      const center = map.getCenter();
      const gta = latLngToGta(center.lat, center.lng);
      centerX = Math.round(gta.x);
      centerY = Math.round(gta.y);
    }

    const points = generateShapePoints(type, centerX, centerY, size);

    setPreviewShape({
      type,
      points,
      centerX,
      centerY,
      scale: size,
      rotation: 0
    });
    setShowTemplateModal(false);
  };

  // Update preview shape position
  const updatePreviewPosition = (centerX: number, centerY: number) => {
    if (!previewShape) return;
    const points = generateShapePoints(previewShape.type, centerX, centerY, previewShape.scale, previewShape.rotation);
    setPreviewShape({ ...previewShape, points, centerX, centerY });
  };

  // Update preview shape scale
  const updatePreviewScale = (scale: number) => {
    if (!previewShape) return;
    const points = generateShapePoints(previewShape.type, previewShape.centerX, previewShape.centerY, scale, previewShape.rotation);
    setPreviewShape({ ...previewShape, points, scale });
  };

  // Update preview shape rotation
  const updatePreviewRotation = (rotation: number) => {
    if (!previewShape) return;
    const points = generateShapePoints(previewShape.type, previewShape.centerX, previewShape.centerY, previewShape.scale, rotation);
    setPreviewShape({ ...previewShape, points, rotation });
  };

  // Confirm preview shape and create zone
  const confirmPreviewShape = () => {
    if (!previewShape) return;

    const typeNames: Record<string, string> = {
      'rectangle': 'Rectangle',
      'circle': 'Circle',
      'triangle': 'Triangle',
      'pentagon': 'Pentagon',
      'hexagon': 'Hexagon',
      'star': 'Star',
      'l-shape': 'L-Shape'
    };

    const newZone: Zone = {
      id: `zone-${Date.now()}`,
      name: `${typeNames[previewShape.type]} Zone`,
      points: previewShape.points,
      color: ZONE_COLORS[zones.length % ZONE_COLORS.length],
      visible: true,
      thickness: 150,
      fillPattern: 'solid',
      groundZ: null
    };

    const newZones = [...zones, newZone];
    setZones(newZones);
    setActiveZoneId(newZone.id);
    setExpandedZones(prev => new Set([...prev, newZone.id]));
    saveToHistory(newZones, newZone.id, true);

    setPreviewShape(null);
    notify.success(`Created ${newZone.name}`);

    // Pan to new zone
    if (mapRef.current && previewShape.points.length > 0) {
      mapRef.current.setView(previewShape.points[0].latLng, mapRef.current.getZoom(), { animate: true });
    }
  };

  // Cancel preview
  const cancelPreviewShape = () => {
    setPreviewShape(null);
    notify.info('Template cancelled');
  };

  // Toggle zone expansion
  const toggleZoneExpansion = (zoneId: string) => {
    setExpandedZones(prev => {
      const newSet = new Set(prev);
      if (newSet.has(zoneId)) newSet.delete(zoneId);
      else newSet.add(zoneId);
      return newSet;
    });
  };

  // Handle close
  const handleClose = () => {
    fetch(`https://${GetParentResourceName()}/closeZoneCreator`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    }).catch(() => {});
    onClose();
  };

  // Héritage RP edit session: send the edited zone back (client.lua closes the creator and answers the caller).
  const handleValidateSession = () => {
    if (!session) return;
    const zone = zones.find(z => z.sessionKey === session.editKey);
    if (!zone || zone.points.length < 3) {
      notify.error('La zone doit avoir au moins 3 points');
      return;
    }
    fetch(`https://${GetParentResourceName()}/editSessionResult`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: session.sessionId,
        zone: {
          points: zone.points.map(p => ({ x: p.gtaCoords.x, y: p.gtaCoords.y })),
          thickness: zone.thickness,
          groundZ: zone.groundZ
        }
      })
    }).catch(() => {});
  };

  // Jump to player position
  const handleJumpToPlayer = () => {
    if (initialPlayerPosition && mapRef.current) {
      mapRef.current.setView(gtaToLatLng(initialPlayerPosition.x, initialPlayerPosition.y), 1, { animate: true });
    }
  };

  return (
    <>
    <Notification notifications={notifications} onDismiss={dismissNotification} />
    <div className="zone-creator" style={{ display: isViewingZone ? 'none' : 'flex' }}>
      {/* Left Panel */}
      <div className="zone-panel">
        {session && (
          <div className="zone-session">
            <div className="zone-session-title">
              <Edit3 size={14} />
              <span>{session.title}</span>
            </div>
            <p className="zone-session-hint">
              Seule la zone « {session.zones.find(z => z.key === session.editKey)?.name} » est renvoyée. Réglez sa hauteur et
              son sol (Ground Z) ici.
            </p>
            <div className="zone-session-actions">
              <button className="zone-btn zone-btn-confirm zone-session-btn" onClick={handleValidateSession}>
                <Check size={14} /><span>Valider</span>
              </button>
              <button className="zone-btn zone-btn-cancel zone-session-btn" onClick={handleClose}>
                <X size={14} /><span>Annuler</span>
              </button>
            </div>
          </div>
        )}
        <div className="zone-panel-header">
          <div className="zone-panel-title">
            <Layers size={18} />
            <span>Zone Creator</span>
          </div>
          <button className="zone-close-btn" onClick={handleClose}>
            <X size={18} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="zone-toolbar">
          <button className={`zone-toolbar-btn ${snapToGridEnabled ? 'active' : ''}`} onClick={() => setSnapToGridEnabled(!snapToGridEnabled)} title="Snap to Grid (G)">
            <Grid size={16} />
          </button>
          <button className={`zone-toolbar-btn ${showDistances ? 'active' : ''}`} onClick={() => setShowDistances(!showDistances)} title="Show Distances (D)">
            <Ruler size={16} />
          </button>
          <button className="zone-toolbar-btn" onClick={handleUndo} disabled={historyIndex <= 0} title="Undo (Ctrl+Z)">
            <RotateCcw size={16} />
          </button>
          <button className="zone-toolbar-btn" onClick={handleRedo} disabled={historyIndex >= history.length - 1} title="Redo (Ctrl+Y)">
            <Redo size={16} />
          </button>
          <div className="zone-toolbar-divider" />
          <button className="zone-toolbar-btn" onClick={() => setShowImportModal(true)} title="Import Zone">
            <Upload size={16} />
          </button>
          <button className="zone-toolbar-btn" onClick={() => setShowTemplateModal(true)} title="Templates">
            <Square size={16} />
          </button>
          <button className="zone-toolbar-btn" onClick={() => setShowSearchModal(true)} title="Search Location (Ctrl+F)">
            <Search size={16} />
          </button>
          {initialPlayerPosition && (
            <button className="zone-toolbar-btn" onClick={handleJumpToPlayer} title="Jump to Player">
              <Navigation size={16} />
            </button>
          )}
        </div>

        {/* Create New Zone */}
        <div className="zone-create-section">
          {isCreatingZone ? (
            <div className="zone-create-form">
              <input type="text" className="zone-name-input" placeholder="Zone name..." value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateZone()} autoFocus />
              <div className="zone-create-actions">
                <button className="zone-btn zone-btn-confirm" onClick={handleCreateZone}><Check size={14} /></button>
                <button className="zone-btn zone-btn-cancel" onClick={() => setIsCreatingZone(false)}><X size={14} /></button>
              </div>
            </div>
          ) : (
            <button className="zone-create-btn" onClick={() => setIsCreatingZone(true)}>
              <Plus size={16} /><span>Create New Zone</span>
            </button>
          )}
        </div>

        {/* Zone List */}
        <div className="zone-list">
          {zones.length === 0 ? (
            <div className="zone-empty">
              <MapPin size={32} />
              <span>No zones created</span>
              <p>Click "Create New Zone" to start</p>
            </div>
          ) : (
            zones.map(zone => (
              <div key={zone.id} className={`zone-item ${zone.id === activeZoneId ? 'active' : ''}`}>
                <div className="zone-item-header" onClick={() => { setActiveZoneId(zone.id === activeZoneId ? null : zone.id); toggleZoneExpansion(zone.id); }}>
                  <div className="zone-item-left">
                    <button className="zone-expand-btn" onClick={(e) => { e.stopPropagation(); toggleZoneExpansion(zone.id); }}>
                      {expandedZones.has(zone.id) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <div className="zone-color-dot" style={{ backgroundColor: zone.color }} />
                    {editingZoneId === zone.id ? (
                      <input type="text" className="zone-edit-input" value={editingName} onChange={(e) => setEditingName(e.target.value)} onBlur={() => { if (editingName.trim()) updateZonesWithHistory(prev => prev.map(z => z.id === editingZoneId ? { ...z, name: editingName.trim() } : z)); setEditingZoneId(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { if (editingName.trim()) updateZonesWithHistory(prev => prev.map(z => z.id === editingZoneId ? { ...z, name: editingName.trim() } : z)); setEditingZoneId(null); }}} onClick={(e) => e.stopPropagation()} autoFocus />
                    ) : (
                      <span className="zone-item-name">{zone.name}</span>
                    )}
                    <span className="zone-point-count">{zone.points.length} pts</span>
                  </div>
                  <div className="zone-item-actions">
                    <button
                      className="zone-action-btn zone-action-view"
                      onClick={(e) => { e.stopPropagation(); handleViewZone(zone); }}
                      title="View in 3D"
                      disabled={zone.points.length < 3}
                    >
                      <Video size={14} />
                    </button>
                    <button className="zone-action-btn" onClick={(e) => { e.stopPropagation(); handleToggleVisibility(zone.id); }} title={zone.visible ? 'Hide' : 'Show'}>
                      {zone.visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button className="zone-action-btn" onClick={(e) => { e.stopPropagation(); setEditingZoneId(zone.id); setEditingName(zone.name); }} title="Rename">
                      <Edit3 size={14} />
                    </button>
                    <button className="zone-action-btn zone-action-delete" onClick={(e) => { e.stopPropagation(); handleDeleteZone(zone.id); }} title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {expandedZones.has(zone.id) && (
                  <div className="zone-item-content">
                    {/* Ground Z & Thickness Controls */}
                    <div className="zone-height-controls">
                      <div className="zone-groundz-field">
                        <div className="zone-groundz-label-row">
                          <label className="number-input-label">Ground Z</label>
                          <button
                            className="zone-groundz-auto-btn"
                            onClick={() => handleCalculateGroundZ(zone.id)}
                            disabled={zone.points.length === 0 || fetchingZoneGroundZ.has(zone.id)}
                            title="Auto-calculate ground Z from zone center"
                          >
                            {fetchingZoneGroundZ.has(zone.id) ? (
                              <Loader2 size={10} className="zone-ground-z-spinner" />
                            ) : (
                              <Wand2 size={10} />
                            )}
                          </button>
                        </div>
                        <NumberInput
                          value={zone.groundZ ?? 0}
                          onChange={(val) => {
                            const newZones = zones.map(z => z.id === zone.id ? { ...z, groundZ: val } : z);
                            setZones(newZones);
                            saveToHistory(newZones, activeZoneId, true);
                          }}
                          onBlur={(val) => {
                            const newZones = zones.map(z => {
                              if (z.id === zone.id) {
                                return {
                                  ...z,
                                  groundZ: val,
                                  points: z.points.map(p => ({
                                    ...p,
                                    gtaCoords: { ...p.gtaCoords, z: val }
                                  }))
                                };
                              }
                              return z;
                            });
                            setZones(newZones);
                            saveToHistory(newZones, activeZoneId, true);
                          }}
                          step={0.5}
                        />
                      </div>
                      <NumberInput
                        label="Thickness"
                        value={zone.thickness}
                        onChange={(val) => handleUpdateZoneThickness(zone.id, val)}
                        step={0.5}
                        min={0.5}
                      />
                    </div>

                    {/* Export Actions */}
                    <div className="zone-export-grid">
                      <button className="zone-export-btn" onClick={() => handleCopyCode(zone, 'polyzone')} disabled={zone.points.length < 3} title="Copy full PolyZone code">
                        <Copy size={12} /><span>PolyZone</span>
                      </button>
                      <button className="zone-export-btn" onClick={() => handleCopyCode(zone, 'oxlib')} disabled={zone.points.length < 3} title="Copy full ox_lib code">
                        <Copy size={12} /><span>OX</span>
                      </button>
                      <button className="zone-export-btn" onClick={() => handleCopyCode(zone, 'vec2')} disabled={zone.points.length === 0} title="Copy coordinates as vector2 list">
                        <Copy size={12} /><span>Vec2</span>
                      </button>
                      <button className="zone-export-btn" onClick={() => handleCopyCode(zone, 'vec3')} disabled={zone.points.length === 0} title="Copy coordinates as vector3 list (with Z)">
                        <Copy size={12} /><span>Vec3</span>
                      </button>
                    </div>

                    {/* Points List */}
                    {zone.points.length > 0 && (
                      <div className="zone-points-list">
                        <span className="zone-points-label">Points:</span>
                        {zone.points.map((point, index) => (
                          <div key={point.id} className="zone-point-item">
                            <span className="zone-point-index">{index + 1}</span>
                            <span className="zone-point-coords">
                              {point.gtaCoords.x}, {point.gtaCoords.y}{point.gtaCoords.z !== null ? `, ${point.gtaCoords.z}` : ''}
                            </span>
                            <button
                              className="zone-point-delete-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                updateZonesWithHistory(prev => prev.map(z => {
                                  if (z.id === zone.id) {
                                    return { ...z, points: z.points.filter(p => p.id !== point.id) };
                                  }
                                  return z;
                                }));
                              }}
                              title="Delete point"
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Instructions */}
        <div className="zone-instructions">
          <div className="zone-instruction"><span className="zone-instruction-key">Click</span><span>Add point</span></div>
          <div className="zone-instruction"><span className="zone-instruction-key">Drag</span><span>Move point</span></div>
          <div className="zone-instruction"><span className="zone-instruction-key">Right-click</span><span>Delete point</span></div>
          <div className="zone-instruction"><span className="zone-instruction-key">Shift+Drag</span><span>Select points</span></div>
          <div className="zone-instruction"><span className="zone-instruction-key">Ctrl+Z/Y</span><span>Undo/Redo</span></div>
        </div>

        {/* Selected Points Actions */}
        {selectedPoints.size > 0 && (
          <div className="zone-selection-actions">
            <span>{selectedPoints.size} point{selectedPoints.size > 1 ? 's' : ''} selected</span>
            <button onClick={handleDeleteSelectedPoints} className="zone-delete-selected-btn">
              <Trash2 size={14} /> Delete
            </button>
          </div>
        )}
      </div>

      {/* Map Container */}
      <div className="zone-map-wrapper">
        <div ref={mapContainerRef} className="zone-map" />

        {/* Zoom Level Indicator */}
        <div className="zone-zoom-indicator">
          <ZoomIn size={14} />
          <span>{Math.round((zoomLevel + 2) * 33)}%</span>
        </div>

        {/* Coordinate Display */}
        {cursorCoords && (
          <div className="zone-coords-display">
            <span>X: {cursorCoords.x}</span>
            <span>Y: {cursorCoords.y}</span>
            {snapToGridEnabled && <span className="snap-indicator">SNAP</span>}
          </div>
        )}

        {/* Active Zone Indicator */}
        {activeZone && (
          <div className="zone-active-indicator">
            <div className="zone-active-color" style={{ backgroundColor: activeZone.color }} />
            <span>Editing: {activeZone.name}</span>
          </div>
        )}

        {/* No Active Zone Message */}
        {!activeZone && zones.length > 0 && !previewShape && (
          <div className="zone-no-active"><span>Select a zone to start adding points</span></div>
        )}

        {/* Shape Preview Controls */}
        {previewShape && !previewControlsHidden && (
          <div className="zone-preview-controls">
            <div className="zone-preview-header">
              <span>Placing {previewShape.type.charAt(0).toUpperCase() + previewShape.type.slice(1)}</span>
              <button className="zone-preview-hide-btn" onClick={() => setPreviewControlsHidden(true)} title="Hide controls">
                <Minimize2 size={14} />
              </button>
            </div>
            <div className="zone-preview-info">
              <div className="zone-preview-coord">
                <label>Position</label>
                <span>X: {previewShape.centerX}, Y: {previewShape.centerY}</span>
              </div>
            </div>
            <div className="zone-preview-scale">
              <label>Scale</label>
              <input
                type="range"
                min="5"
                max="3000"
                value={previewShape.scale}
                onChange={(e) => updatePreviewScale(parseInt(e.target.value))}
              />
              <NumberInput
                value={previewShape.scale}
                onChange={(val) => updatePreviewScale(val)}
                min={5}
                step={5}
              />
            </div>
            <div className="zone-preview-rotation">
              <label>Rotation</label>
              <input
                type="range"
                min="0"
                max="360"
                value={previewShape.rotation}
                onChange={(e) => updatePreviewRotation(parseInt(e.target.value))}
              />
              <NumberInput
                value={previewShape.rotation}
                onChange={(val) => updatePreviewRotation(val)}
                min={0}
                max={360}
                step={5}
                suffix="°"
              />
            </div>
            <div className="zone-preview-hint">
              Drag center point to reposition
            </div>
            <div className="zone-preview-actions">
              <button className="zone-preview-btn cancel" onClick={cancelPreviewShape}>
                <X size={14} /> Cancel
              </button>
              <button className="zone-preview-btn confirm" onClick={confirmPreviewShape}>
                <Check size={14} /> Place Zone
              </button>
            </div>
          </div>
        )}

        {/* Minimized Preview Controls Button */}
        {previewShape && previewControlsHidden && (
          <button className="zone-preview-minimized" onClick={() => setPreviewControlsHidden(false)} title="Show controls">
            <Settings size={18} />
          </button>
        )}
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="zone-modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="zone-modal" onClick={e => e.stopPropagation()}>
            <div className="zone-modal-header">
              <h3>Import Zone</h3>
              <button onClick={() => setShowImportModal(false)}><X size={18} /></button>
            </div>
            <div className="zone-modal-content">
              <p>Paste coordinates or zone code:</p>
              <textarea value={importCode} onChange={e => setImportCode(e.target.value)} placeholder="Supported formats:
vec2(100, 200), vec2(150, 250), ...
vector3(-100.5, 200.3, 50.0), ...
{x = 100, y = 200}, ...
Or full PolyZone/ox_lib code" rows={8} />
            </div>
            <div className="zone-modal-actions">
              <button className="zone-modal-btn secondary" onClick={() => setShowImportModal(false)}>Cancel</button>
              <button className="zone-modal-btn primary" onClick={handleImportZone}>Import</button>
            </div>
          </div>
        </div>
      )}

      {/* Search Modal */}
      {showSearchModal && (
        <div className="zone-modal-overlay" onClick={() => setShowSearchModal(false)}>
          <div className="zone-modal zone-modal-small" onClick={e => e.stopPropagation()}>
            <div className="zone-modal-header">
              <h3>Jump to Location</h3>
              <button onClick={() => setShowSearchModal(false)}><X size={18} /></button>
            </div>
            <div className="zone-modal-content">
              <div className="zone-search-inputs">
                <input type="text" placeholder="X coordinate" value={searchX} onChange={e => setSearchX(e.target.value)} />
                <input type="text" placeholder="Y coordinate" value={searchY} onChange={e => setSearchY(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearchLocation()} />
              </div>
            </div>
            <div className="zone-modal-actions">
              <button className="zone-modal-btn secondary" onClick={() => setShowSearchModal(false)}>Cancel</button>
              <button className="zone-modal-btn primary" onClick={handleSearchLocation}>Go</button>
            </div>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {showTemplateModal && (
        <div className="zone-modal-overlay" onClick={() => setShowTemplateModal(false)}>
          <div className="zone-modal" onClick={e => e.stopPropagation()}>
            <div className="zone-modal-header">
              <h3>Zone Templates</h3>
              <button onClick={() => setShowTemplateModal(false)}><X size={18} /></button>
            </div>
            <div className="zone-modal-content">
              <div className="zone-template-grid zone-template-grid-large">
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('rectangle')}>
                  <Square size={28} /><span>Rectangle</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('circle')}>
                  <Circle size={28} /><span>Circle</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('triangle')}>
                  <Triangle size={28} /><span>Triangle</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('pentagon')}>
                  <Octagon size={28} /><span>Pentagon</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('hexagon')}>
                  <Hexagon size={28} /><span>Hexagon</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('star')}>
                  <Star size={28} /><span>Star</span>
                </button>
                <button className="zone-template-btn" onClick={() => handleCreateTemplate('l-shape')}>
                  <CornerDownRight size={28} /><span>L-Shape</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>

    {/* Zone Viewer Overlay - rendered outside main container so it shows when viewing */}
    {isViewingZone && viewerData && (
      <div className="zone-viewer-overlay">
        <div className="zone-viewer-panel">
          <div className="zone-viewer-header">
            <Video size={18} />
            <h3>Zone Viewer</h3>
          </div>

          <div className="zone-viewer-info">
            <div className="zone-viewer-stat">
              <span className="zone-viewer-stat-label">Thickness</span>
              <span className="zone-viewer-stat-value">{viewerData.thickness.toFixed(1)}</span>
            </div>
          </div>

          <div className="zone-viewer-controls">
            <div className="zone-viewer-key">
              <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd>
              <span>Move</span>
            </div>
            <div className="zone-viewer-key">
              <kbd>Q</kbd><kbd>E</kbd>
              <span>Up/Down</span>
            </div>
            <div className="zone-viewer-key">
              <kbd>Mouse</kbd>
              <span>Look</span>
            </div>
            <div className="zone-viewer-key">
              <kbd>Shift</kbd>
              <span>Sprint</span>
            </div>
            <div className="zone-viewer-key">
              <kbd>↑</kbd><kbd>↓</kbd>
              <span>Thickness</span>
            </div>
            <div className="zone-viewer-key exit">
              <kbd>Backspace</kbd>
              <span>Exit</span>
            </div>
          </div>
        </div>
      </div>
    )}

    </>
  );
};

export default ZoneCreator;
