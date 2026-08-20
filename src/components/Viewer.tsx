import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Piece } from '../types';

/** Punto arrastrable sobre el plano de arriba (z constante). Avisa a App de las
 *  nuevas coordenadas en mm. Lo usan la anilla y el nombre. */
function DragHandle({
  ring,
  onMove,
  onDragChange,
  color = '#ffcf3f',
  radio = 2.7,
  girar = false,
}: {
  ring: { x: number; y: number; z: number };
  onMove: (x: number, y: number) => void;
  onDragChange: (d: boolean) => void;
  color?: string;
  radio?: number;
  /** Dibuja la flecha curva de girar en vez del aro de mover. */
  girar?: boolean;
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

  const material = (
    <meshBasicMaterial color={color} depthTest={false} transparent opacity={0.92} />
  );

  return (
    <group
      position={[ring.x, ring.y, ring.z + 1.5]}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        onDragChange(true);
      }}
      onPointerOver={() => (gl.domElement.style.cursor = 'grab')}
      onPointerOut={() => (gl.domElement.style.cursor = '')}
    >
      {girar ? (
        <>
          {/* La flecha curva de toda la vida. Dos tiradores con la misma forma no
              dicen cuál hace qué; esta se entiende sin explicarla. */}
          <mesh>
            <torusGeometry args={[radio, radio * 0.3, 8, 22, Math.PI * 1.45]} />
            {material}
          </mesh>
          <mesh position={[0, -radio, 0]} rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[radio * 0.62, radio * 1.1, 12]} />
            {material}
          </mesh>
        </>
      ) : (
        /* Un aro y no una bola: el tirador cae justo encima de lo que mueve —el
           nombre, la anilla— y una bola maciza lo tapa. Con el aro se ve por el
           agujero, que es lo que hace falta para colocarlo a ojo. */
        <mesh>
          <torusGeometry args={[radio, radio * 0.3, 10, 26]} />
          {material}
        </mesh>
      )}
    </group>
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

/**
 * «Ver por detrás»: lleva la cámara al otro lado de la cama.
 *
 * La marca del taller se graba en la cara de abajo (la que toca la cama), así
 * que para verla hay que mirar la pieza desde debajo. En vez de pedirle a nadie
 * que arrastre con el ratón hasta dar la vuelta, se refleja la cámara respecto
 * al plano del objetivo y se anima el viaje.
 */
function FlipCamera({ flipped }: { flipped: boolean }) {
  const { camera, controls } = useThree();
  const target = useRef(new THREE.Vector3());
  const done = useRef(true);
  const was = useRef(flipped);

  useFrame(() => {
    const ctl = controls as unknown as { target?: THREE.Vector3; update?: () => void } | null;
    const look = ctl?.target ?? new THREE.Vector3(0, 0, 8);

    // Al cambiar el interruptor se calcula el destino: el reflejo de donde está
    // la cámara respecto al plano horizontal que pasa por el objetivo.
    if (was.current !== flipped) {
      was.current = flipped;
      target.current.set(camera.position.x, camera.position.y, 2 * look.z - camera.position.z);
      done.current = false;
    }
    if (done.current) return;

    camera.position.lerp(target.current, 0.16);
    camera.lookAt(look);
    ctl?.update?.();
    if (camera.position.distanceTo(target.current) < 0.4) {
      camera.position.copy(target.current);
      done.current = true;
    }
  });

  return null;
}

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
  textColor,
  hideTrace,
  viewMode,
  oneColor,
}: {
  piece: Piece;
  offset: number;
  bgColor: string;
  traceColor: string;
  textColor: string;
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
  // El nombre es la ÚLTIMA cola de la malla, detrás del relieve.
  const textLen = piece.textMesh?.positions.length ?? 0;

  // Con «ocultar trazo» se pinta solo la placa: las colas de posiciones (el
  // relieve y el nombre) se recortan, porque van fusionadas dentro de piece.mesh.
  const baseGeom = useMemo(() => {
    const p = piece.mesh.positions;
    return geomOf(hideTrace && overlayLen + textLen ? p.slice(0, p.length - overlayLen - textLen) : p);
  }, [piece.mesh, hideTrace, overlayLen, textLen]);
  const overlayGeom = useMemo(
    () => (!hideTrace && overlayLen ? geomOf(piece.overlay!.positions) : null),
    [piece.overlay, hideTrace, overlayLen],
  );
  const textGeom = useMemo(
    () => (!hideTrace && textLen ? geomOf(piece.textMesh!.positions) : null),
    [piece.textMesh, hideTrace, textLen],
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
      {/* Y el nombre encima de todo, con su propio color. */}
      {textGeom && (
        <mesh geometry={textGeom} castShadow>
          <meshStandardMaterial
            color={oneColor ? bgColor : textColor}
            metalness={0.15}
            roughness={0.5}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
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
  textColor = '#ff5fa2',
  hideTrace = false,
  viewMode = 'solid',
  oneColor = false,
  flipped = false,
  ring = null,
  onRingMove,
  text = null,
  onTextMove,
  textRot = null,
  onTextRot,
}: {
  pieces: Piece[];
  exploded: boolean;
  mark?: string | null;
  bgColor: string;
  traceColor: string;
  /** Color del nombre levantado, en «Llavero imagen + texto». */
  textColor?: string;
  hideTrace?: boolean;
  viewMode?: ViewMode;
  oneColor?: boolean;
  /** Mirar la pieza desde abajo, para ver la marca grabada en la cara trasera. */
  flipped?: boolean;
  ring?: { x: number; y: number; z: number } | null;
  onRingMove?: (x: number, y: number) => void;
  /** Tirador del nombre, en los productos que llevan texto sobre la imagen. */
  text?: { x: number; y: number; z: number } | null;
  onTextMove?: (x: number, y: number) => void;
  /** Tirador para GIRAR el nombre: orbita alrededor del anterior. */
  textRot?: { x: number; y: number; z: number } | null;
  onTextRot?: (x: number, y: number) => void;
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
      // Lienzo transparente: el fondo lo pone el degradado de estudio de `.stage`
      // (ver styles.css), así la escena tiene profundidad en vez de un gris liso.
      gl={{ alpha: true }}
    >
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
          textColor={textColor}
          hideTrace={hideTrace}
          viewMode={viewMode}
          oneColor={oneColor}
        />
      ))}

      {ring && onRingMove && (
        <DragHandle ring={ring} onMove={onRingMove} onDragChange={setDragging} />
      )}
      {text && onTextMove && (
        <DragHandle ring={text} onMove={onTextMove} onDragChange={setDragging} color="#1bc5d4" />
      )}
      {/* El de girar es más pequeño y de otro color: orbita alrededor del de
          mover, y con los dos iguales no se sabría cuál es cuál. */}
      {textRot && onTextRot && (
        <DragHandle
          ring={textRot}
          onMove={onTextRot}
          onDragChange={setDragging}
          color="#a78bfa"
          radio={2.2}
          girar
        />
      )}

      <FlipCamera flipped={flipped} />
      <OrbitControls makeDefault enablePan enabled={!dragging} target={[0, 0, 8]} />
    </Canvas>
    {mark ? <span className="viewer-mark">{mark}</span> : null}
    </div>
  );
}
