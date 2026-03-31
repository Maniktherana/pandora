/**
 * WebGL Terminal Renderer
 *
 * GPU-accelerated terminal rendering using a glyph atlas texture.
 * Architecture:
 *   1. Glyphs are rasterized once into an atlas (offscreen Canvas 2D → WebGL texture)
 *   2. Terminal grid is uploaded as a data texture (cell → atlas UV + colors)
 *   3. A single draw call renders the entire terminal
 *   4. Scrolling updates a uniform — zero re-rendering of content
 */

import type { ITheme } from './interfaces';
import type { SelectionManager } from './selection-manager';
import type { GhosttyCell } from './types';
import { CellFlags } from './types';
import { DEFAULT_THEME } from './renderer';
import type { FontMetrics, IRenderable, IScrollbackProvider, RendererOptions } from './renderer';

// ─── Glyph Atlas ────────────────────────────────────────────────────────────

interface GlyphEntry {
  u: number; // x position in atlas (pixels)
  v: number; // y position in atlas (pixels)
  w: number; // glyph width in atlas (pixels)
  h: number; // glyph height in atlas (pixels)
}

const ATLAS_SIZE = 2048; // atlas texture size (2048×2048 should fit thousands of glyphs)

class GlyphAtlas {
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  readonly size = ATLAS_SIZE;
  private glyphs = new Map<string, GlyphEntry>();
  private cursorX = 0;
  private cursorY = 0;
  private rowHeight = 0;
  dirty = false;

  constructor(
    private fontSize: number,
    private fontFamily: string,
    private cellWidth: number,
    private cellHeight: number,
    private baseline: number,
  ) {
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(ATLAS_SIZE, ATLAS_SIZE);
      this.ctx = this.canvas.getContext('2d')! as OffscreenCanvasRenderingContext2D;
    } else {
      this.canvas = document.createElement('canvas');
      this.canvas.width = ATLAS_SIZE;
      this.canvas.height = ATLAS_SIZE;
      this.ctx = this.canvas.getContext('2d')!;
    }
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    this.rowHeight = cellHeight;
  }

  /** Get or rasterize a glyph. Returns atlas coordinates. */
  get(char: string, bold: boolean, italic: boolean): GlyphEntry {
    const key = `${bold ? 'B' : ''}${italic ? 'I' : ''}${char}`;
    let entry = this.glyphs.get(key);
    if (entry) return entry;

    // Rasterize
    let style = '';
    if (italic) style += 'italic ';
    if (bold) style += 'bold ';
    this.ctx.font = `${style}${this.fontSize}px ${this.fontFamily}`;

    const measured = this.ctx.measureText(char);
    // Use cell dimensions for consistent grid alignment
    const w = Math.max(Math.ceil(measured.width), this.cellWidth);
    const h = this.cellHeight;

    // Check if we need to wrap to next row
    if (this.cursorX + w > this.size) {
      this.cursorX = 0;
      this.cursorY += this.rowHeight;
    }
    // Atlas full — unlikely with 2048×2048 but handle gracefully
    if (this.cursorY + h > this.size) {
      // Reuse the space of a blank glyph
      entry = { u: 0, v: 0, w: this.cellWidth, h: this.cellHeight };
      this.glyphs.set(key, entry);
      return entry;
    }

    // Clear and draw
    this.ctx.clearRect(this.cursorX, this.cursorY, w, h);
    this.ctx.fillStyle = '#ffffff'; // White — shader will multiply by fg color
    this.ctx.fillText(char, this.cursorX, this.cursorY + this.baseline);

    entry = { u: this.cursorX, v: this.cursorY, w, h };
    this.glyphs.set(key, entry);
    this.cursorX += w;
    this.dirty = true;
    return entry;
  }

  clear(): void {
    this.glyphs.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.ctx.clearRect(0, 0, this.size, this.size);
    this.dirty = true;
  }
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const VERT_SRC = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y; // flip Y so row 0 is at top
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// Fragment shader: reads cell data from u_cells texture, looks up glyph in u_atlas.
// Each cell is encoded as 4 pixels (16 bytes) in the cell data texture:
//   pixel 0: (atlasU_lo, atlasU_hi, atlasV_lo, atlasV_hi)  — atlas position
//   pixel 1: (atlasW, atlasH, flags, width)                 — glyph size + flags
//   pixel 2: (fg_r, fg_g, fg_b, 255)                        — foreground color
//   pixel 3: (bg_r, bg_g, bg_b, 255)                        — background color
const FRAG_SRC = `
precision highp float;

varying vec2 v_uv;
uniform sampler2D u_atlas;
uniform sampler2D u_cells;
uniform vec2 u_gridSize;       // (cols, rows)
uniform vec2 u_cellSize;       // (cellWidth, cellHeight) in pixels
uniform vec2 u_canvasSize;     // canvas size in pixels
uniform float u_atlasSize;     // atlas texture size
uniform vec4 u_cursorPos;      // (col, row, visible, style)  style: 0=block, 1=bar, 2=underline
uniform vec3 u_cursorColor;
uniform vec3 u_cursorTextColor;

vec4 readCell(float col, float row) {
  // Cell data texture: each cell = 4 pixels wide, laid out as (col*4 + offset, row)
  // But we pack all 4 pixels for a cell in a single row
  // Texture width = cols * 4, height = rows
  float texW = u_gridSize.x * 4.0;
  float texH = u_gridSize.y;
  vec2 base = vec2((col * 4.0 + 0.5) / texW, (row + 0.5) / texH);
  float dx = 1.0 / texW;
  return vec4(0.0); // placeholder — we read individual pixels below
}

void main() {
  // Which cell are we in?
  vec2 pixelPos = v_uv * u_canvasSize;
  float col = floor(pixelPos.x / u_cellSize.x);
  float row = floor(pixelPos.y / u_cellSize.y);

  // Out of grid bounds — draw background
  if (col >= u_gridSize.x || row >= u_gridSize.y) {
    discard;
    return;
  }

  // Read cell data from texture
  float texW = u_gridSize.x * 4.0;
  float texH = u_gridSize.y;
  float dx = 1.0 / texW;
  float baseX = (col * 4.0 + 0.5) / texW;
  float baseY = (row + 0.5) / texH;

  vec4 p0 = texture2D(u_cells, vec2(baseX, baseY));
  vec4 p1 = texture2D(u_cells, vec2(baseX + dx, baseY));
  vec4 p2 = texture2D(u_cells, vec2(baseX + 2.0 * dx, baseY));
  vec4 p3 = texture2D(u_cells, vec2(baseX + 3.0 * dx, baseY));

  // Decode atlas position (packed as bytes → 0..255 → reconstruct 16-bit)
  float atlasU = (p0.r * 255.0) + (p0.g * 255.0) * 256.0;
  float atlasV = (p0.b * 255.0) + (p0.a * 255.0) * 256.0;
  float atlasW = p1.r * 255.0;
  float atlasH = p1.g * 255.0;
  float flags  = p1.b * 255.0;
  float cellW  = p1.a * 255.0;

  vec3 fg = p2.rgb;
  vec3 bg = p3.rgb;

  // Position within cell (0..1)
  vec2 cellLocal = vec2(
    (pixelPos.x - col * u_cellSize.x) / u_cellSize.x,
    (pixelPos.y - row * u_cellSize.y) / u_cellSize.y
  );

  // Check cursor
  bool isCursorCell = (col == u_cursorPos.x && row == u_cursorPos.y && u_cursorPos.z > 0.5);
  bool inCursorBlock = false;
  bool inCursorBar = false;
  bool inCursorUnderline = false;

  if (isCursorCell) {
    float style = u_cursorPos.w;
    if (style < 0.5) {
      // Block cursor
      inCursorBlock = true;
    } else if (style < 1.5) {
      // Bar cursor (left 2px)
      inCursorBar = cellLocal.x < 2.0 / u_cellSize.x;
    } else {
      // Underline cursor (bottom 2px)
      inCursorUnderline = cellLocal.y > 1.0 - 2.0 / u_cellSize.y;
    }
  }

  // Start with background
  vec3 color = bg;

  // Sample glyph from atlas
  if (atlasW > 0.0 && atlasH > 0.0) {
    // Map cell-local position to atlas UV
    vec2 atlasUV = vec2(
      (atlasU + cellLocal.x * u_cellSize.x) / u_atlasSize,
      (atlasV + cellLocal.y * u_cellSize.y) / u_atlasSize
    );
    float glyphAlpha = texture2D(u_atlas, atlasUV).r; // White glyph — use red channel

    // Blend glyph color
    vec3 textColor = fg;
    if (inCursorBlock) {
      textColor = u_cursorTextColor;
    }
    color = mix(color, textColor, glyphAlpha);
  }

  // Draw cursor overlay
  if (inCursorBlock && (atlasW == 0.0 || atlasH == 0.0)) {
    color = u_cursorColor;
  } else if (inCursorBlock) {
    // Block cursor with text: bg is cursor color, text uses cursor text color (handled above)
    color = mix(u_cursorColor, color, 0.0); // cursor bg behind text
    // Re-sample with cursor colors
    if (atlasW > 0.0) {
      vec2 atlasUV = vec2(
        (atlasU + cellLocal.x * u_cellSize.x) / u_atlasSize,
        (atlasV + cellLocal.y * u_cellSize.y) / u_atlasSize
      );
      float glyphAlpha = texture2D(u_atlas, atlasUV).r;
      color = mix(u_cursorColor, u_cursorTextColor, glyphAlpha);
    }
  }

  if (inCursorBar || inCursorUnderline) {
    color = u_cursorColor;
  }

  // Underline decoration
  float underlineFlag = floor(mod(flags, 8.0) / 4.0); // bit 2
  if (underlineFlag > 0.5) {
    float underlineY = 0.85; // ~85% down the cell
    if (cellLocal.y > underlineY && cellLocal.y < underlineY + 1.5 / u_cellSize.y) {
      color = fg;
    }
  }

  // Strikethrough decoration
  float strikeFlag = floor(mod(flags, 16.0) / 8.0); // bit 3
  if (strikeFlag > 0.5) {
    if (cellLocal.y > 0.45 && cellLocal.y < 0.45 + 1.5 / u_cellSize.y) {
      color = fg;
    }
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

// ─── WebGL Renderer ─────────────────────────────────────────────────────────

export class WebGLRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private atlas: GlyphAtlas;
  private atlasTexture: WebGLTexture;
  private cellTexture: WebGLTexture;
  private cellData: Uint8Array;

  private fontSize: number;
  private fontFamily: string;
  private cursorStyle: 'block' | 'underline' | 'bar' = 'block';
  private cursorBlink: boolean = false;
  private cursorVisible: boolean = true;
  private cursorBlinkInterval?: number;
  private theme: Required<ITheme>;
  private palette: string[];
  private devicePixelRatio: number;
  private metrics: FontMetrics;

  private cols = 0;
  private rows = 0;
  private lastViewportY = 0;

  // Uniform locations
  private uGridSize: WebGLUniformLocation | null = null;
  private uCellSize: WebGLUniformLocation | null = null;
  private uCanvasSize: WebGLUniformLocation | null = null;
  private uAtlasSize: WebGLUniformLocation | null = null;
  private uCursorPos: WebGLUniformLocation | null = null;
  private uCursorColor: WebGLUniformLocation | null = null;
  private uCursorTextColor: WebGLUniformLocation | null = null;

  // Selection manager
  private selectionManager?: SelectionManager;
  private currentSelectionCoords: {
    startCol: number;
    startRow: number;
    endCol: number;
    endRow: number;
  } | null = null;

  // Link hover state
  private hoveredHyperlinkId: number = 0;
  private previousHoveredHyperlinkId: number = 0;
  private hoveredLinkRange: { startX: number; startY: number; endX: number; endY: number } | null = null;
  private previousHoveredLinkRange: { startX: number; startY: number; endX: number; endY: number } | null = null;

  // Current buffer for grapheme lookup
  private currentBuffer: IRenderable | null = null;

  constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
    this.canvas = canvas;
    this.fontSize = options.fontSize ?? 15;
    this.fontFamily = options.fontFamily ?? 'monospace';
    this.cursorStyle = options.cursorStyle ?? 'block';
    this.cursorBlink = options.cursorBlink ?? false;
    this.theme = { ...DEFAULT_THEME, ...options.theme };
    this.devicePixelRatio = options.devicePixelRatio ?? window.devicePixelRatio ?? 1;

    this.palette = this.buildPalette();
    this.metrics = this.measureFont();

    // Create atlas
    this.atlas = new GlyphAtlas(
      this.fontSize * this.devicePixelRatio,
      this.fontFamily,
      Math.ceil(this.metrics.width * this.devicePixelRatio),
      Math.ceil(this.metrics.height * this.devicePixelRatio),
      Math.ceil(this.metrics.baseline * this.devicePixelRatio),
    );

    // Init WebGL
    const gl = canvas.getContext('webgl', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('WebGL not supported');
    this.gl = gl;

    // Compile shaders
    this.program = this.createProgram(VERT_SRC, FRAG_SRC);
    gl.useProgram(this.program);

    // Cache uniform locations
    this.uGridSize = gl.getUniformLocation(this.program, 'u_gridSize');
    this.uCellSize = gl.getUniformLocation(this.program, 'u_cellSize');
    this.uCanvasSize = gl.getUniformLocation(this.program, 'u_canvasSize');
    this.uAtlasSize = gl.getUniformLocation(this.program, 'u_atlasSize');
    this.uCursorPos = gl.getUniformLocation(this.program, 'u_cursorPos');
    this.uCursorColor = gl.getUniformLocation(this.program, 'u_cursorColor');
    this.uCursorTextColor = gl.getUniformLocation(this.program, 'u_cursorTextColor');

    // Fullscreen quad
    const quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, 'a_position');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Create textures
    this.atlasTexture = this.createTexture(gl.TEXTURE0);
    this.cellTexture = this.createTexture(gl.TEXTURE1);
    this.cellData = new Uint8Array(0);

    // Set texture unit uniforms
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_atlas'), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_cells'), 1);
    gl.uniform1f(this.uAtlasSize, ATLAS_SIZE);

    if (this.cursorBlink) this.startCursorBlink();
  }

  // ─── Public API (matches CanvasRenderer interface) ──────────────────────

  public resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;

    const cssW = cols * this.metrics.width;
    const cssH = rows * this.metrics.height;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.ceil(cssW * this.devicePixelRatio);
    this.canvas.height = Math.ceil(cssH * this.devicePixelRatio);

    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    // Allocate cell data buffer: 4 pixels × 4 bytes (RGBA) per cell
    this.cellData = new Uint8Array(cols * 4 * rows * 4);

    // Upload empty cell texture
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.cellTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols * 4, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.cellData);
  }

  public render(
    buffer: IRenderable,
    forceAll: boolean = false,
    viewportY: number = 0,
    scrollbackProvider?: IScrollbackProvider,
    _scrollbarOpacity: number = 1,
  ): void {
    this.currentBuffer = buffer;
    const cursor = buffer.getCursor();
    const dims = buffer.getDimensions();

    if (buffer.needsFullRedraw?.()) forceAll = true;

    // Resize if needed
    if (this.cols !== dims.cols || this.rows !== dims.rows) {
      this.resize(dims.cols, dims.rows);
      forceAll = true;
    }

    const viewportLine = Math.floor(viewportY);
    if (viewportLine !== Math.floor(this.lastViewportY)) {
      forceAll = true;
    }
    this.lastViewportY = viewportY;

    // Update selection coords
    const hasSelection = this.selectionManager?.hasSelection();
    this.currentSelectionCoords = hasSelection ? this.selectionManager!.getSelectionCoords() : null;

    // Check if any rows are dirty
    let needsUpload = forceAll;
    if (!forceAll) {
      for (let y = 0; y < dims.rows; y++) {
        if (buffer.isRowDirty(y)) {
          needsUpload = true;
          break;
        }
      }
    }

    if (needsUpload) {
      // Build cell data texture
      const scrollbackLength = scrollbackProvider?.getScrollbackLength() ?? 0;
      const data = this.cellData;

      for (let row = 0; row < dims.rows; row++) {
        // Fetch line from scrollback or screen
        let line: GhosttyCell[] | null = null;
        if (viewportLine > 0) {
          if (row < viewportLine && scrollbackProvider) {
            const offset = scrollbackLength - viewportLine + row;
            line = scrollbackProvider.getScrollbackLine(offset);
          } else {
            line = buffer.getLine(row - viewportLine);
          }
        } else {
          line = buffer.getLine(row);
        }

        for (let col = 0; col < dims.cols; col++) {
          const cell = line?.[col];
          const baseIdx = (row * dims.cols * 4 + col * 4) * 4; // 4 pixels × 4 bytes

          if (!cell || cell.codepoint === 0 || cell.codepoint === 32) {
            // Empty cell — no glyph
            this.writeCellData(data, baseIdx, 0, 0, 0, 0, 0, 1, cell, row, col);
          } else {
            const bold = !!(cell.flags & CellFlags.BOLD);
            const italic = !!(cell.flags & CellFlags.ITALIC);

            let char: string;
            if (cell.grapheme_len > 0 && this.currentBuffer?.getGraphemeString) {
              char = this.currentBuffer.getGraphemeString(row, col);
            } else {
              char = String.fromCodePoint(cell.codepoint);
            }

            const glyph = this.atlas.get(char, bold, italic);
            this.writeCellData(data, baseIdx, glyph.u, glyph.v, glyph.w, glyph.h, cell.flags, cell.width, cell, row, col);
          }
        }
      }

      // Upload cell data
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cellTexture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, dims.cols * 4, dims.rows, gl.RGBA, gl.UNSIGNED_BYTE, data);
    }

    // Upload atlas if dirty
    if (this.atlas.dirty) {
      const gl = this.gl;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas as any);
      this.atlas.dirty = false;
    }

    // Set uniforms
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.uGridSize, dims.cols, dims.rows);
    gl.uniform2f(this.uCellSize,
      this.metrics.width * this.devicePixelRatio,
      this.metrics.height * this.devicePixelRatio);
    gl.uniform2f(this.uCanvasSize, this.canvas.width, this.canvas.height);

    // Cursor
    const cursorStyleNum = this.cursorStyle === 'block' ? 0 : this.cursorStyle === 'bar' ? 1 : 2;
    const cursorVis = (viewportY === 0 && cursor.visible && this.cursorVisible) ? 1.0 : 0.0;
    gl.uniform4f(this.uCursorPos, cursor.x, cursor.y, cursorVis, cursorStyleNum);

    const cc = this.parseHexColor(this.theme.cursor);
    const cta = this.parseHexColor(this.theme.cursorAccent);
    gl.uniform3f(this.uCursorColor, cc[0], cc[1], cc[2]);
    gl.uniform3f(this.uCursorTextColor, cta[0], cta[1], cta[2]);

    // Draw
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    buffer.clearDirty();
  }

  public getMetrics(): FontMetrics { return this.metrics; }
  public getCanvas(): HTMLCanvasElement { return this.canvas; }
  public get charWidth(): number { return this.metrics.width; }
  public get charHeight(): number { return this.metrics.height; }

  public setSelectionManager(manager: SelectionManager): void { this.selectionManager = manager; }
  public setHoveredHyperlinkId(id: number): void {
    this.previousHoveredHyperlinkId = this.hoveredHyperlinkId;
    this.hoveredHyperlinkId = id;
  }
  public setHoveredLinkRange(range: { startX: number; startY: number; endX: number; endY: number } | null): void {
    this.previousHoveredLinkRange = this.hoveredLinkRange;
    this.hoveredLinkRange = range;
  }

  public setCursorStyle(style: 'block' | 'underline' | 'bar'): void { this.cursorStyle = style; }
  public setCursorBlink(enabled: boolean): void {
    if (enabled && !this.cursorBlink) {
      this.cursorBlink = true;
      this.startCursorBlink();
    } else if (!enabled && this.cursorBlink) {
      this.cursorBlink = false;
      this.stopCursorBlink();
    }
  }

  public setFontSize(size: number): void {
    this.fontSize = size;
    this.metrics = this.measureFont();
    this.rebuildAtlas();
  }

  public setFontFamily(family: string): void {
    this.fontFamily = family;
    this.metrics = this.measureFont();
    this.rebuildAtlas();
  }

  public setTheme(theme: ITheme): void {
    this.theme = { ...DEFAULT_THEME, ...theme };
    this.palette = this.buildPalette();
  }

  public remeasureFont(): void {
    this.metrics = this.measureFont();
    this.rebuildAtlas();
  }

  public clear(): void {
    const gl = this.gl;
    const bg = this.parseHexColor(this.theme.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  public dispose(): void {
    this.stopCursorBlink();
    const gl = this.gl;
    gl.deleteTexture(this.atlasTexture);
    gl.deleteTexture(this.cellTexture);
    gl.deleteProgram(this.program);
    const ext = gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private writeCellData(
    data: Uint8Array,
    baseIdx: number,
    atlasU: number, atlasV: number, atlasW: number, atlasH: number,
    flags: number, width: number,
    cell: GhosttyCell | undefined,
    row: number, col: number,
  ): void {
    // Check if selected
    const isSelected = this.isInSelection(col, row);

    // pixel 0: atlas UV (16-bit packed)
    data[baseIdx + 0] = atlasU & 0xFF;
    data[baseIdx + 1] = (atlasU >> 8) & 0xFF;
    data[baseIdx + 2] = atlasV & 0xFF;
    data[baseIdx + 3] = (atlasV >> 8) & 0xFF;

    // pixel 1: atlas size + flags + width
    data[baseIdx + 4] = atlasW & 0xFF;
    data[baseIdx + 5] = atlasH & 0xFF;
    data[baseIdx + 6] = flags & 0xFF;
    data[baseIdx + 7] = width & 0xFF;

    // pixel 2: foreground color
    if (isSelected) {
      const c = this.parseHexColor(this.theme.selectionForeground);
      data[baseIdx + 8] = Math.round(c[0] * 255);
      data[baseIdx + 9] = Math.round(c[1] * 255);
      data[baseIdx + 10] = Math.round(c[2] * 255);
    } else if (cell) {
      let r = cell.fg_r, g = cell.fg_g, b = cell.fg_b;
      if (cell.flags & CellFlags.INVERSE) { r = cell.bg_r; g = cell.bg_g; b = cell.bg_b; }
      data[baseIdx + 8] = r;
      data[baseIdx + 9] = g;
      data[baseIdx + 10] = b;
    } else {
      const c = this.parseHexColor(this.theme.foreground);
      data[baseIdx + 8] = Math.round(c[0] * 255);
      data[baseIdx + 9] = Math.round(c[1] * 255);
      data[baseIdx + 10] = Math.round(c[2] * 255);
    }
    data[baseIdx + 11] = 255;

    // pixel 3: background color
    if (isSelected) {
      const c = this.parseHexColor(this.theme.selectionBackground);
      data[baseIdx + 12] = Math.round(c[0] * 255);
      data[baseIdx + 13] = Math.round(c[1] * 255);
      data[baseIdx + 14] = Math.round(c[2] * 255);
    } else if (cell) {
      let r = cell.bg_r, g = cell.bg_g, b = cell.bg_b;
      if (cell.flags & CellFlags.INVERSE) { r = cell.fg_r; g = cell.fg_g; b = cell.fg_b; }
      data[baseIdx + 12] = r;
      data[baseIdx + 13] = g;
      data[baseIdx + 14] = b;
    } else {
      const c = this.parseHexColor(this.theme.background);
      data[baseIdx + 12] = Math.round(c[0] * 255);
      data[baseIdx + 13] = Math.round(c[1] * 255);
      data[baseIdx + 14] = Math.round(c[2] * 255);
    }
    data[baseIdx + 15] = 255;
  }

  private isInSelection(col: number, row: number): boolean {
    const sel = this.currentSelectionCoords;
    if (!sel) return false;
    if (row < sel.startRow || row > sel.endRow) return false;
    if (row === sel.startRow && row === sel.endRow) {
      return col >= sel.startCol && col < sel.endCol;
    }
    if (row === sel.startRow) return col >= sel.startCol;
    if (row === sel.endRow) return col < sel.endCol;
    return true;
  }

  private createProgram(vertSrc: string, fragSrc: string): WebGLProgram {
    const gl = this.gl;
    const vs = gl.createShader(gl.VERTEX_SHADER)!;
    gl.shaderSource(vs, vertSrc);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      throw new Error('Vertex shader error: ' + gl.getShaderInfoLog(vs));
    }

    const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      throw new Error('Fragment shader error: ' + gl.getShaderInfoLog(fs));
    }

    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }

    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return prog;
  }

  private createTexture(unit: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.activeTexture(unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private measureFont(): FontMetrics {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.font = `${this.fontSize}px ${this.fontFamily}`;
    ctx.textBaseline = 'alphabetic';

    const measured = ctx.measureText('M');
    const width = measured.width;
    const ascent = measured.actualBoundingBoxAscent;
    const descent = measured.actualBoundingBoxDescent;
    const height = Math.ceil(ascent + descent + 2);
    const baseline = Math.ceil(ascent + 1);

    return { width, height, baseline };
  }

  private parseHexColor(hex: string): [number, number, number] {
    let h = hex.startsWith('#') ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    const n = parseInt(h, 16);
    return [(n >> 16 & 0xFF) / 255, (n >> 8 & 0xFF) / 255, (n & 0xFF) / 255];
  }

  private buildPalette(): string[] {
    return [
      this.theme.black, this.theme.red, this.theme.green, this.theme.yellow,
      this.theme.blue, this.theme.magenta, this.theme.cyan, this.theme.white,
      this.theme.brightBlack, this.theme.brightRed, this.theme.brightGreen, this.theme.brightYellow,
      this.theme.brightBlue, this.theme.brightMagenta, this.theme.brightCyan, this.theme.brightWhite,
    ];
  }

  private rebuildAtlas(): void {
    this.atlas = new GlyphAtlas(
      this.fontSize * this.devicePixelRatio,
      this.fontFamily,
      Math.ceil(this.metrics.width * this.devicePixelRatio),
      Math.ceil(this.metrics.height * this.devicePixelRatio),
      Math.ceil(this.metrics.baseline * this.devicePixelRatio),
    );
  }

  private startCursorBlink(): void {
    this.stopCursorBlink();
    this.cursorBlinkInterval = window.setInterval(() => {
      this.cursorVisible = !this.cursorVisible;
    }, 530);
  }

  private stopCursorBlink(): void {
    if (this.cursorBlinkInterval !== undefined) {
      clearInterval(this.cursorBlinkInterval);
      this.cursorBlinkInterval = undefined;
    }
    this.cursorVisible = true;
  }
}
