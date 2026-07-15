import { useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Piece } from '../types';

/** El color dice qué hace la pieza: cian corta, rosa marca, gris sostiene. */
const COLORS: Record<Piece['role'], string> = {
  blade: '#1bc5d4',
  icing: '#ff5fa2',
  body: '#93a3b3',
};

function PieceMesh({ piece, offset }: { piece: Piece; offset: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(piece.mesh.positions, 3));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }, [piece.mesh]);

  const ref = useRef<THREE.Mesh>(null);

  useFrame((_, dt) => {
    if (!ref.current) return;
    ref.current.position.x += (offset - ref.current.position.x) * Math.min(1, dt * 6);
  });

  return (
    <mesh ref={ref} geometry={geom} castShadow receiveShadow>
      <meshStandardMaterial
        color={COLORS[piece.role]}
        metalness={0.15}
        roughness={0.45}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function Viewer({
  pieces,
  exploded,
  mark,
}: {
  pieces: Piece[];
  exploded: boolean;
  mark?: string | null;
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
        />
      ))}

      <OrbitControls makeDefault enablePan target={[0, 0, 8]} />
    </Canvas>
    {mark ? <span className="viewer-mark">{mark}</span> : null}
    </div>
  );
}
