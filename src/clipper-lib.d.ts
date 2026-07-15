/** clipper-lib no trae tipos. Solo se declara lo que MoldeLab usa. */
declare module 'clipper-lib' {
  export interface IntPoint {
    X: number;
    Y: number;
  }
  type Path = IntPoint[];

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    Execute(solution: Path[], delta: number): void;
  }

  export const JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
  export const EndType: {
    etClosedPolygon: number;
    etClosedLine: number;
    etOpenbutt: number;
    etOpenSquare: number;
    etOpenRound: number;
  };
  export const PolyFillType: {
    pftEvenOdd: number;
    pftNonZero: number;
    pftPositive: number;
    pftNegative: number;
  };

  export class Clipper {
    constructor();
    AddPath(path: Path, polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Path[], subjFill?: number, clipFill?: number): boolean;
    static Orientation(path: Path): boolean;
    static Area(path: Path): number;
    static PointInPolygon(pt: IntPoint, path: Path): number;
    static SimplifyPolygons(paths: Path[], fillType?: number): Path[];
    static CleanPolygons(paths: Path[], distance?: number): Path[];
  }

  export const PolyType: { ptSubject: number; ptClip: number };
  export const ClipType: {
    ctIntersection: number;
    ctUnion: number;
    ctDifference: number;
    ctXor: number;
  };

  const ClipperLib: {
    ClipperOffset: typeof ClipperOffset;
    JoinType: typeof JoinType;
    EndType: typeof EndType;
    PolyFillType: typeof PolyFillType;
    PolyType: typeof PolyType;
    ClipType: typeof ClipType;
    Clipper: typeof Clipper;
  };
  export default ClipperLib;
}
