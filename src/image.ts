// Rotation + downscaling for the photo before it is sent to the API.
// The preview canvas and the uploaded JPEG are produced by the same function,
// so what the user sees upright is exactly what the model receives.

export type Rotation = 0 | 90 | 180 | 270;

/** Turn clockwise (+1) or counter-clockwise (-1) by 90 degrees. */
export function turn(r: Rotation, dir: 1 | -1): Rotation {
  return ((((r + dir * 90) % 360) + 360) % 360) as Rotation;
}

/** Output canvas size: swap width/height for 90/270, then shrink so the long edge is <= maxEdge. */
export function outputSize(srcW: number, srcH: number, rotation: Rotation, maxEdge: number) {
  const sideways = rotation === 90 || rotation === 270;
  const w = sideways ? srcH : srcW;
  const h = sideways ? srcW : srcH;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)), scale };
}

export function drawRotated(canvas: HTMLCanvasElement, img: ImageBitmap, rotation: Rotation, maxEdge: number) {
  const { width, height, scale } = outputSize(img.width, img.height, rotation, maxEdge);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser");
  ctx.fillStyle = "#fff"; // JPEG has no alpha
  ctx.fillRect(0, 0, width, height);
  ctx.translate(width / 2, height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale);
}

export const PREVIEW_EDGE = 900;
export const UPLOAD_EDGE = 1800;

/** Rotated, downscaled JPEG as base64 (no data: prefix). */
export function renderUploadJpeg(img: ImageBitmap, rotation: Rotation): string {
  const canvas = document.createElement("canvas");
  drawRotated(canvas, img, rotation, UPLOAD_EDGE);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}
