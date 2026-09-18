export type HandsFreeFrame = {
  /** Frame counter since the module loaded. */
  seq: number;
  /** Device uptime in ms when the frame was analysed. */
  t: number;
  /** Capture time in ms, in the camera's monotonic clock. Use for intervals only. */
  cap: number;
  /** Upright analysis image size in pixels (landmarks are normalised to it). */
  w: number;
  h: number;
  /** True while no hand has been seen for a while and frames are analysed at a lower rate. */
  idle: boolean;
  /** Largest face: centre and width, normalised 0–1 in a mirrored, upright image. Only while head tracking is requested. */
  face?: { x: number; y: number; w: number };
  /** 21 MediaPipe hand landmarks as [x0, y0, x1, y1, …], normalised 0–1, same space as `face`. */
  hand?: number[];
  /** Diagnostics: ms spent on copy+rotate, the face detector and the hand model. */
  cost?: number[];
  /** Diagnostics: where the hand model runs. */
  delegate?: 'cpu' | 'gpu';
  /** Diagnostics: the frame-rate range requested from the camera. */
  fps?: [number, number] | null;
  /**
   * Diagnostics, only when the camera clock is comparable with the system
   * clock: capture → analyser (ms), wall-clock capture time and send time.
   */
  queued?: number;
  wall?: number;
  sent?: number;
};

export type PermissionResponse = { granted: boolean; canAskAgain: boolean; status: string };

export type HandsFreeModuleEvents = {
  onFrame: (frame: HandsFreeFrame) => void;
  onError: (event: { message: string }) => void;
};
