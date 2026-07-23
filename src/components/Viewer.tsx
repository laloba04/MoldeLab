import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Piece } from '../types';

/** Punto arrastrable: la anilla del llavero. Se mueve sobre el plano de arriba
 *  (z constante) y avisa a App de las nuevas coordenadas en mm. */
function DragHandle({
  ring,
  onMove,
  onDragChange,
}: {
  ring: { x: number; y: number; z: number };
  onMove: (x: number, y: number) => void;
  onDragChange: (d: boolean) => void;
}) {
  const { camera, gl } = useThree();
  const dragging = useRef(false);
  const ray = useRef(new THREE.Raycaster());
  const plane = useRef(new THREE.Plane());
  const hit = useRef(new THREE.Vector3());
  const cb = useRef(onMove);
  cb.current = onMove;

  useEffect(() => {
    const toWorld = (e: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      ray.current.setFromCamera(ndc, camera);
      plane.current.set(new THREE.Vector3(0, 0, 1), -ring.z);
      return ray.current.ray.intersectPlane(plane.current, hit.current);
    };
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      const w = toWorld(e);
      if (w) cb.current(w.x, w.y);
    };
    const up = () => {
      if (dragging.current) {
        dragging.current = false;
        onDragChange(false);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [camera, gl, ring.z, onDragChange]);

  return (
    <mesh
      position={[ring.x, ring.y, ring.z + 1.5]}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        onDragChange(true);
      }}
      onPointerOver={() => (gl.domElement.style.cursor = 'grab')}
      onPointerOut={() => (gl.domElement.style.cursor = '')}
    >
      <sphereGeometry args={[3, 20, 20]} />
      <meshBasicMaterial color="#ffcf3f" depthTest={false} transparent opacity={0.92} />
    </mesh>
  );
}

function geomOf(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

type ViewMode = 'solid' | 'xray' | 'wire';

/** Propiedades del material según el modo de vista. */
function matProps(mode: ViewMode) {
  if (mode === 'xray') return { transparent: true, opacity: 0.4, depthWrite: false } as const;
  if (mode === 'wire') return { wireframe: true } as const;
  return {} as const;
}

function PieceMesh({
  piece,
  offset,
  bgColor,
  traceColor,
  hideTrace,
  viewMode,
  oneColor,
}: {
  piece: Piece;
  offset: number;
  bgColor: string;
  traceColor: string;
  hideTrace: boolean;
  viewMode: ViewMode;
  oneColor: boolean;
}) {
  // El cortador conserva su cian (corta) para distinguirlo de un vistazo. Las
  // piezas con color propio (las capas de color) mandan sobre el color de
  // fondo; el resto usa el de fondo. Con «todo de un color» no hay excepciones:
  // se ve tal cual va a salir de la impresora, de una sola tinta.
  const baseColor = oneColor
    ? bgColor
    : piece.role === 'blade'
      ? '#1bc5d4'
      : (piece.tint ?? bgColor);
  const overlayLen = piece.overlay?.positions.length ?? 0;

  // Con «ocultar trazo» se pinta solo la placa: la cola de posiciones (el
  // relieve) se recorta, porque va fusionada dentro de piece.mesh.
  const baseGeom = useMemo(() => {
    const p = piece.mesh.positions;
    return geomOf(hideTrace && overlayLen ? p.slice(0, p.length - overlayLen) : p);
  }, [piece.mesh, hideTrace, overlayLen]);
  const overlayGeom = useMemo(
    () => (!hideTrace && overlayLen ? geomOf(piece.overlay!.positions) : null),
    [piece.overlay, hideTrace, overlayLen],
  );

  const ref = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.x += (offset - ref.current.position.x) * Math.min(1, dt * 6);
  });

  const extra = matProps(viewMode);

  return (
    <group ref={ref}>
      <mesh geometry={baseGeom} castShadow receiveShadow>
        <meshStandardMaterial
          color={baseColor}
          metalness={0.15}
          roughness={0.5}
          side={THREE.DoubleSide}
          {...extra}
        />
      </mesh>
      {/* El relieve se repinta encima con el color del trazo. polygonOffset lo
          adelanta un pelín para que gane al fondo sin parpadear (z-fighting). */}
      {overlayGeom && (
        <mesh geometry={overlayGeom} castShadow>
          <meshStandardMaterial
            color={traceColor}
            metalness={0.15}
            roughness={0.5}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            {...extra}
          />
        </mesh>
      )}
    </group>
  );
}

export function Viewer({
  pieces,
  exploded,
  mark,
  bgColor,
  traceColor,
  hideTrace = false,
  viewMode = 'solid',
  oneColor = false,
  ring = null,
  onRingMove,
}: {
  pieces: Piece[];
  exploded: boolean;
  mark?: string | null;
  bgColor: string;
  traceColor: string;
  hideTrace?: boolean;
  viewMode?: ViewMode;
  oneColor?: boolean;
  ring?: { x: number; y: number; z: number } | null;
  onRingMove?: (x: number, y: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // Las piezas se separan en fila, no en montón.
  const span = useMemo(() => {
    let max = 0;
    for (const p of pieces) {
      const xs = p.mesh.positions;
      for (let i = 0; i < xs.length; i += 3) max = Math.max(max, Math.abs(xs[i]));
    }
    return max * 2 + 15;
  }, [pieces]);

  return (
    <div className="viewer-wrap">
    <Canvas
      shadows
      camera={{ position: [80, -130, 100], fov: 40, up: [0, 0, 1], near: 1, far: 3000 }}
      dpr={[1, 2]}
    >
      <color attach="background" args={['#111820']} />
      <hemisphereLight intensity={0.5} groundColor="#0b1016" />
      {/* La cámara de sombras por defecto de three solo abarca 10x10 unidades
          alrededor del origen: fuera de ahí no hay sombra, y dentro la pieza se
          sombreaba a sí misma y salía un cuadrado rayado en mitad del modelo.
          Aquí se abre a toda la cama y se separa la sombra de la superficie. */}
      <directionalLight
        position={[60, -80, 140]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-normalBias={1}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
        shadow-camera-near={1}
        shadow-camera-far={600}
      />
      <directionalLight position={[-80, 60, 60]} intensity={0.6} />

      {/* La cama de impresión: la referencia mental de cualquiera que imprima. */}
      <Grid
        args={[240, 240]}
        cellSize={10}
        cellThickness={0.6}
        cellColor="#22303d"
        sectionSize={50}
        sectionThickness={1.1}
        sectionColor="#31485c"
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, 0, -0.02]}
        infiniteGrid
        fadeDistance={480}
      />

      {pieces.map((p, i) => (
        <PieceMesh
          key={p.id}
          piece={p}
          offset={exploded && pieces.length > 1 ? (i - (pieces.length - 1) / 2) * span : 0}
          bgColor={bgColor}
          traceColor={traceColor}
          hideTrace={hideTrace}
          viewMode={viewMode}
          oneColor={oneColor}
        />
      ))}

      {ring && onRingMove && (
        <DragHandle ring={ring} onMove={onRingMove} onDragChange={setDragging} />
      )}

      <OrbitControls makeDefault enablePan enabled={!dragging} target={[0, 0, 8]} />
    </Canvas>
    {mark ? <span className="viewer-mark">{mark}</span> : null}
    </div>
  );
}
