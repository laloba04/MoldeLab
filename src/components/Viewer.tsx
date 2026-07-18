import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Piece } from '../types';

function geomOf(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

function PieceMesh({
  piece,
  offset,
  bgColor,
  traceColor,
}: {
  piece: Piece;
  offset: number;
  bgColor: string;
  traceColor: string;
}) {
  // El cortador conserva su cian (corta); el resto usa el color de fondo.
  const baseColor = piece.role === 'blade' ? '#1bc5d4' : bgColor;

  const baseGeom = useMemo(() => geomOf(piece.mesh.positions), [piece.mesh]);
  const overlayGeom = useMemo(
    () => (piece.overlay?.positions.length ? geomOf(piece.overlay.positions) : null),
    [piece.overlay],
  );

  const ref = useRef<THREE.Group>(null);

  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.x += (offset - ref.current.position.x) * Math.min(1, dt * 6);
  });

  return (
    <group ref={ref}>
      <mesh geometry={baseGeom} castShadow receiveShadow>
        <meshStandardMaterial
          color={baseColor}
          metalness={0.15}
          roughness={0.5}
          side={THREE.DoubleSide}
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
}: {
  pieces: Piece[];
  exploded: boolean;
  mark?: string | null;
  bgColor: string;
  traceColor: string;
}) {
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
      <directionalLight
        position={[60, -80, 140]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[1024, 1024]}
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
        />
      ))}

      <OrbitControls makeDefault enablePan target={[0, 0, 8]} />
    </Canvas>
    {mark ? <span className="viewer-mark">{mark}</span> : null}
    </div>
  );
}
