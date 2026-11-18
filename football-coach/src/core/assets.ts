/** Loads public/assets/manifest.json and every image it lists. */
export interface FrameRect { x: number; y: number; w: number; h: number; ox: number; oy: number }
export interface Manifest {
  characterLayout: { frameW: number; frameH: number; anims: Record<string, { row: number; frames: number[] }>; standFrame: number };
  characters: Record<string, { file: string; angry?: string; furious?: string }>;
  portraits: Record<string, string>;
  tiles: { file: string; size: number; names: string[] };
  objects: { file: string; frames: Record<string, FrameRect> };
  icons: { file: string; size: number; names: string[] };
}

export class Assets {
  manifest!: Manifest;
  private images = new Map<string, HTMLImageElement>();

  constructor(private readonly base = 'assets/') {}

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    // The single-file package (tools/package-single.mjs) embeds everything, because a
    // double-clicked file:// page is not allowed to fetch files next to it.
    const embed = (window as unknown as { __ANDY_EMBED?: { manifest: Manifest; files: Record<string, string> } }).__ANDY_EMBED;
    if (embed) this.manifest = embed.manifest;
    else this.manifest = (await (await fetch(this.base + 'manifest.json')).json()) as Manifest;
    const src = (f: string) => embed?.files[f] ?? this.base + f;
    const m = this.manifest;
    const files = new Set<string>([m.tiles.file, m.objects.file, m.icons.file, ...Object.values(m.portraits)]);
    for (const c of Object.values(m.characters)) [c.file, c.angry, c.furious].forEach((f) => f && files.add(f));
    let done = 0;
    await Promise.all(
      [...files].map(
        (f) =>
          new Promise<void>((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
              this.images.set(f, img);
              onProgress?.(++done, files.size);
              resolve();
            };
            img.onerror = () => reject(new Error(`Could not load ${this.base + f}`));
            img.src = src(f);
          }),
      ),
    );
  }

  img(file: string): HTMLImageElement {
    const i = this.images.get(file);
    if (!i) throw new Error(`Image not loaded: ${file}`);
    return i;
  }

  has(file: string | undefined): boolean {
    return !!file && this.images.has(file);
  }
}
