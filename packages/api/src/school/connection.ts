import { z } from 'zod';

export const canvasPluginKey = 'school-canvas';
export const canvasAuthField = 'school_canvas_connection';
const storedSchema = z.object({ origin: z.string(), token: z.string() });

export interface CanvasConnectionStore {
  findOnePluginAuth(input: {
    userId: string;
    authField: string;
    pluginKey: string;
  }): Promise<{ value: string } | null>;
}

/** The caller supplies the authenticated owner, never a model-supplied identity. */
export async function readCanvasConnection({
  userId,
  origin,
  store,
  decrypt,
}: {
  userId: string;
  origin: string;
  store: CanvasConnectionStore;
  decrypt: (value: string) => Promise<string>;
}): Promise<string | null> {
  const row = await store.findOnePluginAuth({
    userId,
    authField: canvasAuthField,
    pluginKey: canvasPluginKey,
  });
  if (!row) return null;
  const stored = storedSchema.parse(JSON.parse(await decrypt(row.value)));
  return stored.origin === origin ? stored.token : null;
}
