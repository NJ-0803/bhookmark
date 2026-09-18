export type HandsFreeFrame = {
  /** Device uptime in ms when the frame was analysed. */
  t: number;
  /** Largest face: centre and width, normalised 0–1 in a mirrored, upright image. */
  face?: { x: number; y: number; w: number };
  /** 21 MediaPipe hand landmarks as [x0, y0, x1, y1, …], normalised 0–1, same space as `face`. */
  hand?: number[];
  /** Wall-clock ms when the camera captured the frame (for measuring delay). */
  wall?: number;
  /** Test measurements: ms spent converting the image, detecting the face, and finding the hand. */
  cost?: number[];
  /** Test measurement: whether the hand model runs on the GPU. */
  gpu?: boolean;
  queued?: number;
  sent?: number;
};

export type PermissionResponse = { granted: boolean; canAskAgain: boolean; status: string };

export type HandsFreeModuleEvents = {
  onFrame: (frame: HandsFreeFrame) => void;
  onError: (event: { message: string }) => void;
};
