#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readPsd, Layer, Psd } from "ag-psd";
import * as fs from "fs";
import * as path from "path";

// Types
interface LayerInfo {
  name: string;
  type: "text" | "image" | "shape" | "group" | "unknown";
  visible: boolean;
  opacity: number;
  bounds: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  text?: {
    content: string;
    font?: string;
    fontSize?: number;
    color?: string;
    lineHeight?: number;
    letterSpacing?: number;
  };
  children?: LayerInfo[];
}

interface PsdInfo {
  width: number;
  height: number;
  colorMode: string;
  bitsPerChannel: number;
  layers: LayerInfo[];
}

// Helper: Color to hex (ag-psd uses different color formats)
function colorToHex(color: any): string | undefined {
  if (!color) return undefined;
  
  // Handle FRGB format (0-1 range)
  if (typeof color.fr === 'number') {
    const r = Math.round(color.fr * 255).toString(16).padStart(2, "0");
    const g = Math.round(color.fg * 255).toString(16).padStart(2, "0");
    const b = Math.round(color.fb * 255).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  
  // Handle RGB format (0-255 range)
  if (typeof color.r === 'number') {
    const r = Math.round(color.r).toString(16).padStart(2, "0");
    const g = Math.round(color.g).toString(16).padStart(2, "0");
    const b = Math.round(color.b).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
  
  return undefined;
}

// Extract layer info recursively
function extractLayerInfo(layer: Layer): LayerInfo {
  const bounds = {
    left: layer.left ?? 0,
    top: layer.top ?? 0,
    width: (layer.right ?? 0) - (layer.left ?? 0),
    height: (layer.bottom ?? 0) - (layer.top ?? 0),
  };

  let type: LayerInfo["type"] = "unknown";
  let textInfo: LayerInfo["text"] | undefined;

  // Determine layer type
  if (layer.text) {
    type = "text";
    const style = layer.text.style;
    textInfo = {
      content: layer.text.text || "",
      font: style?.font?.name,
      fontSize: style?.fontSize,
      color: colorToHex(style?.fillColor),
      lineHeight: style?.leading,
      letterSpacing: style?.tracking,
    };
  } else if (layer.children && layer.children.length > 0) {
    type = "group";
  } else if (layer.canvas) {
    type = "image";
  } else if (layer.vectorMask || layer.vectorStroke) {
    type = "shape";
  }

  const info: LayerInfo = {
    name: layer.name || "Unnamed",
    type,
    visible: !layer.hidden,
    opacity: layer.opacity !== undefined ? layer.opacity / 255 : 1,
    bounds,
  };

  if (textInfo) {
    info.text = textInfo;
  }

  if (layer.children && layer.children.length > 0) {
    info.children = layer.children.map(extractLayerInfo);
  }

  return info;
}

// Parse PSD file
function parsePsdFile(filePath: string): PsdInfo {
  const absolutePath = path.resolve(filePath);
  
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }

  const buffer = fs.readFileSync(absolutePath);
  const psd = readPsd(buffer, {
    skipCompositeImageData: false,
    skipLayerImageData: false,
    skipThumbnail: true,
  });

  const colorModes: { [key: number]: string } = {
    0: "Bitmap",
    1: "Grayscale",
    2: "Indexed",
    3: "RGB",
    4: "CMYK",
    7: "Multichannel",
    8: "Duotone",
    9: "Lab",
  };

  return {
    width: psd.width,
    height: psd.height,
    colorMode: colorModes[psd.colorMode ?? 3] || "Unknown",
    bitsPerChannel: psd.bitsPerChannel ?? 8,
    layers: psd.children?.map(extractLayerInfo) || [],
  };
}

// Get text layers only (flattened)
function getTextLayers(layers: LayerInfo[]): LayerInfo[] {
  const result: LayerInfo[] = [];

  function traverse(items: LayerInfo[]) {
    for (const layer of items) {
      if (layer.type === "text") {
        result.push(layer);
      }
      if (layer.children) {
        traverse(layer.children);
      }
    }
  }

  traverse(layers);
  return result;
}

// Note: Image layer export removed for simplicity
// For image layers, you can export them from Photoshop/Affinity separately

// Create MCP Server
const server = new Server(
  {
    name: "psd-parser",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "parse_psd",
        description:
          "Parse a PSD file and return document info with all layers including text content, sizes, positions, and hierarchy",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_text_layers",
        description:
          "Get only text layers from a PSD file with their content, font info, and positions",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_hero_section",
        description:
          "Analyze a PSD and extract hero section information optimized for coding (heading, subheading, CTA, background)",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            heroGroupName: {
              type: "string",
              description: "Name of the hero group/folder in PSD (optional, will auto-detect if not provided)",
            },
          },
          required: ["path"],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "parse_psd": {
        const filePath = (args as { path: string }).path;
        const psdInfo = parsePsdFile(filePath);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(psdInfo, null, 2),
            },
          ],
        };
      }

      case "get_text_layers": {
        const filePath = (args as { path: string }).path;
        const psdInfo = parsePsdFile(filePath);
        const textLayers = getTextLayers(psdInfo.layers);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  documentSize: { width: psdInfo.width, height: psdInfo.height },
                  textLayers,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case "get_hero_section": {
        const { path: filePath, heroGroupName } = args as {
          path: string;
          heroGroupName?: string;
        };
        const psdInfo = parsePsdFile(filePath);

        // Find hero section (by name or auto-detect top-level large group)
        let heroLayers = psdInfo.layers;
        if (heroGroupName) {
          const findGroup = (layers: LayerInfo[]): LayerInfo[] | null => {
            for (const layer of layers) {
              if (layer.name.toLowerCase().includes(heroGroupName.toLowerCase())) {
                return layer.children || [layer];
              }
              if (layer.children) {
                const found = findGroup(layer.children);
                if (found) return found;
              }
            }
            return null;
          };
          heroLayers = findGroup(psdInfo.layers) || psdInfo.layers;
        }

        // Extract text layers for hero
        const textLayers = getTextLayers(heroLayers);

        // Categorize by size/position (heuristic)
        const categorized = {
          documentSize: { width: psdInfo.width, height: psdInfo.height },
          heading: null as LayerInfo | null,
          subheading: null as LayerInfo | null,
          body: [] as LayerInfo[],
          cta: [] as LayerInfo[],
        };

        // Sort by font size (largest = heading)
        const sorted = [...textLayers].sort((a, b) => {
          const sizeA = a.text?.fontSize || 0;
          const sizeB = b.text?.fontSize || 0;
          return sizeB - sizeA;
        });

        if (sorted.length > 0) categorized.heading = sorted[0];
        if (sorted.length > 1) categorized.subheading = sorted[1];
        if (sorted.length > 2) categorized.body = sorted.slice(2);

        // Detect CTA (button-like names)
        const ctaKeywords = ["button", "cta", "btn", "action", "click", "submit"];
        for (const layer of heroLayers) {
          if (ctaKeywords.some((kw) => layer.name.toLowerCase().includes(kw))) {
            categorized.cta.push(layer);
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(categorized, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text" as const,
          text: `Error: ${message}`,
        },
      ],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("PSD Parser MCP Server running on stdio");
}

main().catch(console.error);
