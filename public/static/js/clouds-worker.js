// Makes the typhoon's cloud tiles off the main thread (see clouds.js).
import { cloudTile } from "./clouds.js";

const offscreen = (size) => new OffscreenCanvas(size, size);

self.onmessage = ({ data }) => {
  const { id, bitmap, upsideDown, native, params } = data;
  try {
    const cloud = cloudTile(bitmap, upsideDown, native, params, offscreen);
    bitmap.close();
    // Cesium uploads ImageBitmaps as they are (WebGL cannot flip them), so it
    // expects them upside down, the way it decodes its own.
    const size = cloud.width;
    const out = offscreen(size);
    const context = out.getContext("2d");
    context.translate(0, size);
    context.scale(1, -1);
    context.drawImage(cloud, 0, 0);
    const result = out.transferToImageBitmap();
    self.postMessage({ id, bitmap: result }, [result]);
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
