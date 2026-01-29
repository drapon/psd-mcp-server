#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import "ag-psd/initialize-canvas.js";
import { readPsd, Layer, Psd, BezierPath, VectorContent } from "ag-psd";
import * as fs from "fs";
import * as path from "path";
import { createCanvas } from "canvas";

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
  if (typeof color.fr === "number") {
    const r = Math.round(color.fr * 255)
      .toString(16)
      .padStart(2, "0");
    const g = Math.round(color.fg * 255)
      .toString(16)
      .padStart(2, "0");
    const b = Math.round(color.fb * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  // Handle RGB format (0-255 range)
  if (typeof color.r === "number") {
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
    skipCompositeImageData: true,
    skipLayerImageData: true,
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

// Convert VectorContent color to CSS color string
function vectorContentToColor(
  content: VectorContent | undefined,
): string | undefined {
  if (!content) return undefined;
  if (content.type === "color") {
    const color = content.color;
    if ("r" in color) {
      return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
    }
  }
  return undefined;
}

// Convert Bezier paths to SVG path data
function bezierPathsToSvgPath(
  paths: BezierPath[],
  width: number,
  height: number,
): string {
  const pathData: string[] = [];

  for (const bezierPath of paths) {
    const knots = bezierPath.knots;
    if (knots.length === 0) continue;

    // PSD bezier points are normalized (0-1), scale to document size
    // points array: [prevAnchorX, prevAnchorY, anchorX, anchorY, nextAnchorX, nextAnchorY]
    const scaleX = (v: number) => (v * width).toFixed(2);
    const scaleY = (v: number) => (v * height).toFixed(2);

    // Start with first knot
    const firstKnot = knots[0];
    const startX = scaleX(firstKnot.points[2]);
    const startY = scaleY(firstKnot.points[3]);
    pathData.push(`M ${startX} ${startY}`);

    // Draw curves between knots
    for (let i = 0; i < knots.length; i++) {
      const currentKnot = knots[i];
      const nextKnot = knots[(i + 1) % knots.length];

      // Skip last segment if path is open
      if (bezierPath.open && i === knots.length - 1) break;

      // Control point 1: current knot's "next" anchor
      const cp1x = scaleX(currentKnot.points[4]);
      const cp1y = scaleY(currentKnot.points[5]);

      // Control point 2: next knot's "prev" anchor
      const cp2x = scaleX(nextKnot.points[0]);
      const cp2y = scaleY(nextKnot.points[1]);

      // End point: next knot's anchor
      const endX = scaleX(nextKnot.points[2]);
      const endY = scaleY(nextKnot.points[3]);

      pathData.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`);
    }

    // Close path if not open
    if (!bezierPath.open) {
      pathData.push("Z");
    }
  }

  return pathData.join(" ");
}

// Find vector layer by name
function findVectorLayer(layers: Layer[], name: string): Layer | null {
  for (const layer of layers) {
    if (
      layer.name?.toLowerCase().includes(name.toLowerCase()) &&
      layer.vectorMask
    ) {
      return layer;
    }
    if (layer.children) {
      const found = findVectorLayer(layer.children, name);
      if (found) return found;
    }
  }
  return null;
}

// Get all vector layers
function getAllVectorLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];

  function traverse(items: Layer[]) {
    for (const layer of items) {
      if (layer.vectorMask) {
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

// Convert a vector layer to SVG string
function vectorLayerToSvg(layer: Layer, width: number, height: number): string {
  if (!layer.vectorMask) {
    throw new Error("Layer does not have vector data");
  }

  const paths = layer.vectorMask.paths;
  const svgPath = bezierPathsToSvgPath(paths, width, height);

  // Get fill color
  const fillColor = vectorContentToColor(layer.vectorFill) || "#000000";

  // Get stroke info
  const stroke = layer.vectorStroke;
  const strokeColor = stroke?.content
    ? vectorContentToColor(stroke.content)
    : undefined;
  const strokeWidth = stroke?.lineWidth?.value || 0;
  const strokeEnabled = stroke?.strokeEnabled !== false && strokeWidth > 0;

  // Build SVG
  const svgParts: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <path d="${svgPath}"`,
    `        fill="${layer.vectorFill ? fillColor : "none"}"`,
  ];

  if (strokeEnabled && strokeColor) {
    svgParts.push(`        stroke="${strokeColor}"`);
    svgParts.push(`        stroke-width="${strokeWidth}"`);
    if (stroke?.lineCapType) {
      svgParts.push(`        stroke-linecap="${stroke.lineCapType}"`);
    }
    if (stroke?.lineJoinType) {
      svgParts.push(`        stroke-linejoin="${stroke.lineJoinType}"`);
    }
  }

  svgParts.push(`  />`);
  svgParts.push(`</svg>`);

  return svgParts.join("\n");
}

// Get all image layers (layers with canvas data)
function getAllImageLayers(layers: Layer[]): Layer[] {
  const result: Layer[] = [];

  function traverse(items: Layer[]) {
    for (const layer of items) {
      // Has canvas and is not a group
      if (layer.canvas && !layer.children) {
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

// Get image layers from a specific group
function getImageLayersFromGroup(layers: Layer[], groupName: string): Layer[] {
  // Find the group first
  function findGroup(items: Layer[]): Layer | null {
    for (const layer of items) {
      if (
        layer.name?.toLowerCase().includes(groupName.toLowerCase()) &&
        layer.children
      ) {
        return layer;
      }
      if (layer.children) {
        const found = findGroup(layer.children);
        if (found) return found;
      }
    }
    return null;
  }

  const group = findGroup(layers);
  if (!group || !group.children) return [];

  return getAllImageLayers(group.children);
}

// Export layer canvas to PNG buffer
function layerToPngBuffer(layer: Layer, scale: number = 2): Buffer | null {
  if (!layer.canvas) return null;

  const srcCanvas = layer.canvas as any;
  const width = srcCanvas.width * scale;
  const height = srcCanvas.height * scale;

  // Create scaled canvas
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Scale and draw
  ctx.scale(scale, scale);
  ctx.drawImage(srcCanvas, 0, 0);

  return canvas.toBuffer("image/png");
}

// Sanitize filename
function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
}

// Format layers as tree structure
function formatLayerTree(layers: LayerInfo[], prefix: string = ""): string {
  const lines: string[] = [];

  layers.forEach((layer, index) => {
    const isLast = index === layers.length - 1;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = isLast ? "    " : "│   ";

    const typeLabel =
      layer.type === "group"
        ? "(group)"
        : layer.type === "text"
          ? "(text)"
          : layer.type === "image"
            ? "(image)"
            : layer.type === "shape"
              ? "(shape)"
              : "";

    const visibilityMark = layer.visible ? "" : " [hidden]";
    lines.push(
      `${prefix}${connector}${layer.name} ${typeLabel}${visibilityMark}`,
    );

    if (layer.children && layer.children.length > 0) {
      lines.push(formatLayerTree(layer.children, prefix + childPrefix));
    }
  });

  return lines.join("\n");
}

// Find layer by name (recursive search)
function findLayerByName(
  layers: LayerInfo[],
  name: string,
  exact: boolean = false,
): LayerInfo | null {
  for (const layer of layers) {
    const match = exact
      ? layer.name === name
      : layer.name.toLowerCase().includes(name.toLowerCase());

    if (match) {
      return layer;
    }

    if (layer.children) {
      const found = findLayerByName(layer.children, name, exact);
      if (found) return found;
    }
  }
  return null;
}

// Search layers by name (returns all matches)
function searchLayersByName(layers: LayerInfo[], name: string): LayerInfo[] {
  const results: LayerInfo[] = [];

  function traverse(items: LayerInfo[]) {
    for (const layer of items) {
      if (layer.name.toLowerCase().includes(name.toLowerCase())) {
        results.push(layer);
      }
      if (layer.children) {
        traverse(layer.children);
      }
    }
  }

  traverse(layers);
  return results;
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
  },
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "export_all_vectors_as_svg",
        description:
          "Export all vector/shape layers as SVG files to a specified directory",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            outputDir: {
              type: "string",
              description: "Directory to save SVG files",
            },
            groupName: {
              type: "string",
              description: "Optional: Only export vectors from this group",
            },
          },
          required: ["path", "outputDir"],
        },
      },
      {
        name: "export_images",
        description:
          "Export image layers as PNG files (@2x scale for Retina). Can export from a specific group or all images.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            outputDir: {
              type: "string",
              description: "Directory to save PNG files",
            },
            groupName: {
              type: "string",
              description: "Optional: Only export images from this group",
            },
            scale: {
              type: "number",
              description: "Scale factor (default: 2 for @2x)",
            },
          },
          required: ["path", "outputDir"],
        },
      },
      {
        name: "list_vector_layers",
        description:
          "List all vector/shape layers in a PSD file that can be exported as SVG",
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
        name: "export_vector_as_svg",
        description:
          "Export a vector/shape layer as SVG. Returns the SVG string or saves to a file.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            layerName: {
              type: "string",
              description: "Name of the vector layer to export",
            },
            outputPath: {
              type: "string",
              description:
                "Optional: Path to save the SVG file. If not provided, returns the SVG string.",
            },
          },
          required: ["path", "layerName"],
        },
      },
      {
        name: "list_layers",
        description:
          "List all layers in a PSD file as a tree structure. Great for getting an overview of the document structure.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            depth: {
              type: "number",
              description:
                "Maximum depth to display (optional, default: unlimited)",
            },
          },
          required: ["path"],
        },
      },
      {
        name: "get_layer_by_name",
        description:
          "Find a layer by name and return its detailed information including position, size, and text content if applicable",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            name: {
              type: "string",
              description:
                "Layer name to search for (partial match, case-insensitive)",
            },
            exact: {
              type: "boolean",
              description: "If true, require exact name match (default: false)",
            },
          },
          required: ["path", "name"],
        },
      },
      {
        name: "get_layer_children",
        description:
          "Get the children of a specific group layer. Use this to drill down into nested groups.",
        inputSchema: {
          type: "object" as const,
          properties: {
            path: {
              type: "string",
              description: "Absolute path to the PSD file",
            },
            groupName: {
              type: "string",
              description: "Name of the group layer to get children from",
            },
            format: {
              type: "string",
              enum: ["tree", "detailed"],
              description:
                "Output format: 'tree' for simple tree view, 'detailed' for full info (default: tree)",
            },
          },
          required: ["path", "groupName"],
        },
      },
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
              description:
                "Name of the hero group/folder in PSD (optional, will auto-detect if not provided)",
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
      case "export_all_vectors_as_svg": {
        const {
          path: filePath,
          outputDir,
          groupName,
        } = args as {
          path: string;
          outputDir: string;
          groupName?: string;
        };
        const absolutePath = path.resolve(filePath);
        const absoluteOutputDir = path.resolve(outputDir);

        if (!fs.existsSync(absolutePath)) {
          throw new Error(`File not found: ${absolutePath}`);
        }

        // Create output directory if it doesn't exist
        if (!fs.existsSync(absoluteOutputDir)) {
          fs.mkdirSync(absoluteOutputDir, { recursive: true });
        }

        const buffer = fs.readFileSync(absolutePath);
        const psd = readPsd(buffer, {
          skipCompositeImageData: true,
          skipLayerImageData: true,
          skipThumbnail: true,
        });

        let vectorLayers: Layer[];
        if (groupName) {
          // Find group and get vectors from it
          const findGroup = (layers: Layer[]): Layer | null => {
            for (const layer of layers) {
              if (
                layer.name?.toLowerCase().includes(groupName.toLowerCase()) &&
                layer.children
              ) {
                return layer;
              }
              if (layer.children) {
                const found = findGroup(layer.children);
                if (found) return found;
              }
            }
            return null;
          };
          const group = findGroup(psd.children || []);
          vectorLayers = group ? getAllVectorLayers(group.children || []) : [];
        } else {
          vectorLayers = getAllVectorLayers(psd.children || []);
        }

        if (vectorLayers.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: groupName
                  ? `No vector layers found in group "${groupName}".`
                  : "No vector layers found in this PSD file.",
              },
            ],
          };
        }

        const exported: string[] = [];
        for (const layer of vectorLayers) {
          try {
            const svg = vectorLayerToSvg(layer, psd.width, psd.height);
            const filename = sanitizeFilename(layer.name || "unnamed") + ".svg";
            const outputPath = path.join(absoluteOutputDir, filename);
            fs.writeFileSync(outputPath, svg, "utf-8");
            exported.push(filename);
          } catch (e) {
            // Skip layers that fail to export
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Exported ${exported.length} SVG file(s) to ${absoluteOutputDir}:\n\n${exported.map((f) => `- ${f}`).join("\n")}`,
            },
          ],
        };
      }

      case "export_images": {
        const {
          path: filePath,
          outputDir,
          groupName,
          scale = 2,
        } = args as {
          path: string;
          outputDir: string;
          groupName?: string;
          scale?: number;
        };
        const absolutePath = path.resolve(filePath);
        const absoluteOutputDir = path.resolve(outputDir);

        if (!fs.existsSync(absolutePath)) {
          throw new Error(`File not found: ${absolutePath}`);
        }

        // Create output directory if it doesn't exist
        if (!fs.existsSync(absoluteOutputDir)) {
          fs.mkdirSync(absoluteOutputDir, { recursive: true });
        }

        const buffer = fs.readFileSync(absolutePath);
        const psd = readPsd(buffer, {
          skipCompositeImageData: true,
          skipLayerImageData: false, // Need image data for export
          skipThumbnail: true,
        });

        let imageLayers: Layer[];
        if (groupName) {
          imageLayers = getImageLayersFromGroup(psd.children || [], groupName);
        } else {
          imageLayers = getAllImageLayers(psd.children || []);
        }

        if (imageLayers.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: groupName
                  ? `No image layers found in group "${groupName}".`
                  : "No image layers found in this PSD file.",
              },
            ],
          };
        }

        const exported: string[] = [];
        const suffix = scale !== 1 ? `@${scale}x` : "";

        for (const layer of imageLayers) {
          try {
            const pngBuffer = layerToPngBuffer(layer, scale);
            if (pngBuffer) {
              const filename =
                sanitizeFilename(layer.name || "unnamed") + suffix + ".png";
              const outputPath = path.join(absoluteOutputDir, filename);
              fs.writeFileSync(outputPath, pngBuffer);
              exported.push(filename);
            }
          } catch (e) {
            // Skip layers that fail to export
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Exported ${exported.length} PNG file(s) at ${scale}x to ${absoluteOutputDir}:\n\n${exported.map((f) => `- ${f}`).join("\n")}`,
            },
          ],
        };
      }

      case "list_vector_layers": {
        const filePath = (args as { path: string }).path;
        const absolutePath = path.resolve(filePath);

        if (!fs.existsSync(absolutePath)) {
          throw new Error(`File not found: ${absolutePath}`);
        }

        const buffer = fs.readFileSync(absolutePath);
        const psd = readPsd(buffer, {
          skipCompositeImageData: true,
          skipLayerImageData: true,
          skipThumbnail: true,
        });

        const vectorLayers = getAllVectorLayers(psd.children || []);

        if (vectorLayers.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "No vector layers found in this PSD file.",
              },
            ],
          };
        }

        const layerList = vectorLayers
          .map((layer) => {
            const hasFill = !!layer.vectorFill;
            const hasStroke = !!layer.vectorStroke?.strokeEnabled;
            return `- ${layer.name} (fill: ${hasFill ? "yes" : "no"}, stroke: ${hasStroke ? "yes" : "no"})`;
          })
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${vectorLayers.length} vector layer(s):\n\n${layerList}`,
            },
          ],
        };
      }

      case "export_vector_as_svg": {
        const {
          path: filePath,
          layerName,
          outputPath,
        } = args as {
          path: string;
          layerName: string;
          outputPath?: string;
        };
        const absolutePath = path.resolve(filePath);

        if (!fs.existsSync(absolutePath)) {
          throw new Error(`File not found: ${absolutePath}`);
        }

        const buffer = fs.readFileSync(absolutePath);
        const psd = readPsd(buffer, {
          skipCompositeImageData: true,
          skipLayerImageData: true,
          skipThumbnail: true,
        });

        const vectorLayer = findVectorLayer(psd.children || [], layerName);

        if (!vectorLayer) {
          const allVectors = getAllVectorLayers(psd.children || []);
          const suggestions = allVectors
            .slice(0, 5)
            .map((l) => l.name)
            .join(", ");
          return {
            content: [
              {
                type: "text" as const,
                text: `Vector layer "${layerName}" not found.\n\nAvailable vector layers: ${suggestions || "none"}`,
              },
            ],
          };
        }

        const svg = vectorLayerToSvg(vectorLayer, psd.width, psd.height);

        if (outputPath) {
          const absoluteOutputPath = path.resolve(outputPath);
          fs.writeFileSync(absoluteOutputPath, svg, "utf-8");
          return {
            content: [
              {
                type: "text" as const,
                text: `SVG saved to: ${absoluteOutputPath}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: svg,
            },
          ],
        };
      }

      case "list_layers": {
        const { path: filePath, depth } = args as {
          path: string;
          depth?: number;
        };
        const psdInfo = parsePsdFile(filePath);

        // Apply depth limit if specified
        function limitDepth(
          layers: LayerInfo[],
          currentDepth: number,
          maxDepth: number,
        ): LayerInfo[] {
          if (currentDepth >= maxDepth) {
            return layers.map((l) => ({
              ...l,
              children: l.children?.length
                ? [
                    {
                      name: `... (${l.children.length} children)`,
                      type: "unknown" as const,
                      visible: true,
                      opacity: 1,
                      bounds: { left: 0, top: 0, width: 0, height: 0 },
                    },
                  ]
                : undefined,
            }));
          }
          return layers.map((l) => ({
            ...l,
            children: l.children
              ? limitDepth(l.children, currentDepth + 1, maxDepth)
              : undefined,
          }));
        }

        const layersToShow = depth
          ? limitDepth(psdInfo.layers, 0, depth)
          : psdInfo.layers;
        const tree = formatLayerTree(layersToShow);

        return {
          content: [
            {
              type: "text" as const,
              text: `PSD: ${psdInfo.width}x${psdInfo.height}\n\n${tree}`,
            },
          ],
        };
      }

      case "get_layer_by_name": {
        const {
          path: filePath,
          name: layerName,
          exact,
        } = args as {
          path: string;
          name: string;
          exact?: boolean;
        };
        const psdInfo = parsePsdFile(filePath);
        const layer = findLayerByName(
          psdInfo.layers,
          layerName,
          exact ?? false,
        );

        if (!layer) {
          // Show suggestions
          const similar = searchLayersByName(
            psdInfo.layers,
            layerName.slice(0, 3),
          );
          const suggestions = similar
            .slice(0, 5)
            .map((l) => l.name)
            .join(", ");
          return {
            content: [
              {
                type: "text" as const,
                text: `Layer "${layerName}" not found.\n\nSimilar layers: ${suggestions || "none"}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(layer, null, 2),
            },
          ],
        };
      }

      case "get_layer_children": {
        const {
          path: filePath,
          groupName,
          format,
        } = args as {
          path: string;
          groupName: string;
          format?: "tree" | "detailed";
        };
        const psdInfo = parsePsdFile(filePath);
        const group = findLayerByName(psdInfo.layers, groupName, false);

        if (!group) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Group "${groupName}" not found.`,
              },
            ],
          };
        }

        if (!group.children || group.children.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `"${group.name}" has no children (type: ${group.type})`,
              },
            ],
          };
        }

        const outputFormat = format ?? "tree";
        const output =
          outputFormat === "tree"
            ? formatLayerTree(group.children)
            : JSON.stringify(group.children, null, 2);

        return {
          content: [
            {
              type: "text" as const,
              text: `Children of "${group.name}" (${group.children.length} items):\n\n${output}`,
            },
          ],
        };
      }

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
                  documentSize: {
                    width: psdInfo.width,
                    height: psdInfo.height,
                  },
                  textLayers,
                },
                null,
                2,
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
              if (
                layer.name.toLowerCase().includes(heroGroupName.toLowerCase())
              ) {
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
        const ctaKeywords = [
          "button",
          "cta",
          "btn",
          "action",
          "click",
          "submit",
        ];
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
