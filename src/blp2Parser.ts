export interface Blp2Result {
    width: number;
    height: number;
    rgba: Uint8Array;
}

export function parseBlp2(buf: Buffer): Blp2Result {
    if (buf.length < 148) {
        throw new Error('File too small to be a valid BLP2 file');
    }

    const magic = buf.toString('ascii', 0, 4);
    if (magic !== 'BLP2') {
        throw new Error(`Not a BLP2 file (magic: "${magic}")`);
    }

    const type = buf.readUInt32LE(4);
    if (type === 0) {
        throw new Error('JPEG-compressed BLP2 files are not supported');
    }

    // offset 8: encoding  (1=palette, 2=DXT, 3=uncompressed ARGB)
    // offset 9: alphaDepth (0, 1, 4, 8 bits of alpha per pixel)
    // offset 10: alphaEncoding (0=DXT1, 1=DXT3, 7=DXT5)
    const encoding     = buf.readUInt8(8);
    const alphaDepth   = buf.readUInt8(9);
    const alphaEncoding = buf.readUInt8(10);

    const width  = buf.readUInt32LE(12);
    const height = buf.readUInt32LE(16);

    if (width === 0 || height === 0) {
        throw new Error('Invalid BLP2 dimensions');
    }

    // mipOffsets[16] at offset 20, mipSizes[16] at offset 84
    const mipOffset = buf.readUInt32LE(20); // first mip
    const mipSize   = buf.readUInt32LE(84);

    if (mipOffset + mipSize > buf.length) {
        throw new Error('Mip data extends beyond file bounds');
    }

    switch (encoding) {
        case 1: {
            // Palettized: 256-entry BGRA palette at offset 148
            const palette = readPalette(buf, 148);
            const mipData = buf.slice(mipOffset, mipOffset + mipSize);
            return { width, height, rgba: decodePalette(mipData, palette, width, height, alphaDepth) };
        }
        case 2: {
            // DXT compressed
            const mipData = buf.slice(mipOffset, mipOffset + mipSize);
            let rgba: Uint8Array;
            if (alphaDepth === 0) {
                rgba = decodeDXT1(mipData, width, height, false);
            } else if (alphaDepth === 1) {
                rgba = decodeDXT1(mipData, width, height, true);
            } else if (alphaEncoding === 1) {
                rgba = decodeDXT3(mipData, width, height);
            } else if (alphaEncoding === 7) {
                rgba = decodeDXT5(mipData, width, height);
            } else {
                // Fallback: DXT1 without transparency
                rgba = decodeDXT1(mipData, width, height, false);
            }
            return { width, height, rgba };
        }
        case 3: {
            // Uncompressed BGRA
            const mipData = buf.slice(mipOffset, mipOffset + mipSize);
            return { width, height, rgba: decodeUncompressed(mipData, width, height) };
        }
        default:
            throw new Error(`Unsupported BLP2 encoding byte: ${encoding}`);
    }
}

// ---------------------------------------------------------------------------
// Palette helpers
// ---------------------------------------------------------------------------

function readPalette(buf: Buffer, offset: number): Uint32Array {
    const palette = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        palette[i] = buf.readUInt32LE(offset + i * 4);
    }
    return palette;
}

function decodePalette(
    data: Buffer,
    palette: Uint32Array,
    width: number,
    height: number,
    alphaDepth: number
): Uint8Array {
    const pixelCount = width * height;
    const rgba = new Uint8Array(pixelCount * 4);

    // Color indices
    for (let i = 0; i < pixelCount; i++) {
        const color = palette[data[i]]; // stored as BGRA
        rgba[i * 4 + 0] = (color >>> 16) & 0xFF; // R
        rgba[i * 4 + 1] = (color >>> 8)  & 0xFF; // G
        rgba[i * 4 + 2] =  color         & 0xFF; // B
        rgba[i * 4 + 3] = 255;
    }

    // Alpha channel (immediately follows color indices in the mip block)
    if (alphaDepth === 8) {
        for (let i = 0; i < pixelCount; i++) {
            rgba[i * 4 + 3] = data[pixelCount + i];
        }
    } else if (alphaDepth === 4) {
        for (let i = 0; i < pixelCount; i++) {
            const byte   = data[pixelCount + (i >>> 1)];
            const nibble = (i & 1) === 0 ? byte & 0xF : (byte >>> 4) & 0xF;
            rgba[i * 4 + 3] = (nibble << 4) | nibble; // expand 4→8 bit
        }
    } else if (alphaDepth === 1) {
        for (let i = 0; i < pixelCount; i++) {
            const bit = (data[pixelCount + (i >>> 3)] >>> (i & 7)) & 1;
            rgba[i * 4 + 3] = bit ? 255 : 0;
        }
    }

    return rgba;
}

function decodeUncompressed(data: Buffer, width: number, height: number): Uint8Array {
    const pixelCount = width * height;
    const rgba = new Uint8Array(pixelCount * 4);
    for (let i = 0; i < pixelCount; i++) {
        rgba[i * 4 + 0] = data[i * 4 + 2]; // R
        rgba[i * 4 + 1] = data[i * 4 + 1]; // G
        rgba[i * 4 + 2] = data[i * 4 + 0]; // B
        rgba[i * 4 + 3] = data[i * 4 + 3]; // A
    }
    return rgba;
}

// ---------------------------------------------------------------------------
// DXT helpers
// ---------------------------------------------------------------------------

function expand5to8(v: number): number { return (v << 3) | (v >>> 2); }
function expand6to8(v: number): number { return (v << 2) | (v >>> 4); }

function rgb565(c16: number): [number, number, number] {
    return [
        expand5to8((c16 >>> 11) & 0x1F),
        expand6to8((c16 >>> 5)  & 0x3F),
        expand5to8( c16         & 0x1F),
    ];
}

/**
 * Returns 4 packed 0xAARRGGBB colors for a DXT1 block.
 * `punchThroughAlpha`: when true, index 3 is transparent (c0 <= c1 mode).
 */
function dxt1Colors(
    c0: number,
    c1: number,
    punchThroughAlpha: boolean
): [number, number, number, number] {
    const [r0, g0, b0] = rgb565(c0);
    const [r1, g1, b1] = rgb565(c1);

    const pack = (a: number, r: number, g: number, b: number): number =>
        ((a << 24) | (r << 16) | (g << 8) | b);

    const col0 = pack(0xFF, r0, g0, b0);
    const col1 = pack(0xFF, r1, g1, b1);

    if (c0 > c1 || !punchThroughAlpha) {
        // 4-colour mode
        return [
            col0,
            col1,
            pack(0xFF, (r0 * 2 + r1) / 3 | 0, (g0 * 2 + g1) / 3 | 0, (b0 * 2 + b1) / 3 | 0),
            pack(0xFF, (r0 + r1 * 2) / 3 | 0, (g0 + g1 * 2) / 3 | 0, (b0 + b1 * 2) / 3 | 0),
        ];
    } else {
        // 3-colour + transparent mode
        return [
            col0,
            col1,
            pack(0xFF, (r0 + r1) >>> 1, (g0 + g1) >>> 1, (b0 + b1) >>> 1),
            0, // transparent
        ];
    }
}

function writePixel(
    rgba: Uint8Array,
    dst: number,
    color: number,
    alpha: number
): void {
    rgba[dst + 0] = (color >>> 16) & 0xFF;
    rgba[dst + 1] = (color >>> 8)  & 0xFF;
    rgba[dst + 2] =  color         & 0xFF;
    rgba[dst + 3] = alpha;
}

// ---------------------------------------------------------------------------
// DXT1
// ---------------------------------------------------------------------------

export function decodeDXT1(
    data: Buffer,
    width: number,
    height: number,
    punchThroughAlpha: boolean
): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    const bw = Math.ceil(width  / 4) || 1;
    const bh = Math.ceil(height / 4) || 1;
    let offset = 0;

    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            const c0      = data.readUInt16LE(offset);
            const c1      = data.readUInt16LE(offset + 2);
            const indices = data.readUInt32LE(offset + 4);
            offset += 8;

            const colors = dxt1Colors(c0, c1, punchThroughAlpha);

            for (let py = 0; py < 4; py++) {
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;
                    if (x >= width || y >= height) { continue; }

                    const ci    = (indices >>> ((py * 4 + px) * 2)) & 0x3;
                    const color = colors[ci];
                    writePixel(rgba, (y * width + x) * 4, color, (color >>> 24) & 0xFF);
                }
            }
        }
    }
    return rgba;
}

// ---------------------------------------------------------------------------
// DXT3
// ---------------------------------------------------------------------------

export function decodeDXT3(data: Buffer, width: number, height: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    const bw = Math.ceil(width  / 4) || 1;
    const bh = Math.ceil(height / 4) || 1;
    let offset = 0;

    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            // 8 bytes: explicit 4-bit alpha for all 16 pixels
            const aLo = data.readUInt32LE(offset);
            const aHi = data.readUInt32LE(offset + 4);
            offset += 8;

            const c0      = data.readUInt16LE(offset);
            const c1      = data.readUInt16LE(offset + 2);
            const indices = data.readUInt32LE(offset + 4);
            offset += 8;

            const colors = dxt1Colors(c0, c1, false);

            for (let py = 0; py < 4; py++) {
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;
                    if (x >= width || y >= height) { continue; }

                    const pi     = py * 4 + px;
                    const ci     = (indices >>> (pi * 2)) & 0x3;
                    const color  = colors[ci];
                    const aWord  = pi < 8 ? aLo : aHi;
                    const nibble = (aWord >>> ((pi % 8) * 4)) & 0xF;
                    const alpha  = (nibble << 4) | nibble; // expand 4→8 bit

                    writePixel(rgba, (y * width + x) * 4, color, alpha);
                }
            }
        }
    }
    return rgba;
}

// ---------------------------------------------------------------------------
// DXT5
// ---------------------------------------------------------------------------

function dxt5AlphaTable(a0: number, a1: number): [number, number, number, number, number, number, number, number] {
    const t: [number, number, number, number, number, number, number, number] =
        [a0, a1, 0, 0, 0, 0, 0, 0];

    if (a0 > a1) {
        t[2] = ((a0 * 6 + a1 * 1) / 7) | 0;
        t[3] = ((a0 * 5 + a1 * 2) / 7) | 0;
        t[4] = ((a0 * 4 + a1 * 3) / 7) | 0;
        t[5] = ((a0 * 3 + a1 * 4) / 7) | 0;
        t[6] = ((a0 * 2 + a1 * 5) / 7) | 0;
        t[7] = ((a0 * 1 + a1 * 6) / 7) | 0;
    } else {
        t[2] = ((a0 * 4 + a1 * 1) / 5) | 0;
        t[3] = ((a0 * 3 + a1 * 2) / 5) | 0;
        t[4] = ((a0 * 2 + a1 * 3) / 5) | 0;
        t[5] = ((a0 * 1 + a1 * 4) / 5) | 0;
        t[6] = 0;
        t[7] = 255;
    }
    return t;
}

export function decodeDXT5(data: Buffer, width: number, height: number): Uint8Array {
    const rgba = new Uint8Array(width * height * 4);
    const bw = Math.ceil(width  / 4) || 1;
    const bh = Math.ceil(height / 4) || 1;
    let offset = 0;

    for (let by = 0; by < bh; by++) {
        for (let bx = 0; bx < bw; bx++) {
            // 8 bytes: DXT5 alpha block
            const a0 = data[offset];
            const a1 = data[offset + 1];
            // 48-bit alpha index table split into two 24-bit integers (pixels 0-7, 8-15)
            const ai0 = data[offset + 2] | (data[offset + 3] << 8) | (data[offset + 4] << 16);
            const ai1 = data[offset + 5] | (data[offset + 6] << 8) | (data[offset + 7] << 16);
            offset += 8;

            const c0      = data.readUInt16LE(offset);
            const c1      = data.readUInt16LE(offset + 2);
            const indices = data.readUInt32LE(offset + 4);
            offset += 8;

            const alphaTable = dxt5AlphaTable(a0, a1);
            const colors     = dxt1Colors(c0, c1, false);

            for (let py = 0; py < 4; py++) {
                for (let px = 0; px < 4; px++) {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;
                    if (x >= width || y >= height) { continue; }

                    const pi    = py * 4 + px;
                    const ci    = (indices >>> (pi * 2)) & 0x3;
                    const color = colors[ci];
                    const ai    = pi < 8
                        ? (ai0 >>> (pi * 3)) & 0x7
                        : (ai1 >>> ((pi - 8) * 3)) & 0x7;
                    const alpha = alphaTable[ai];

                    writePixel(rgba, (y * width + x) * 4, color, alpha);
                }
            }
        }
    }
    return rgba;
}
