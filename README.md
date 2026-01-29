# psd-mcp-server

MCP Server for parsing PSD files and extracting layer information for LLM coding assistance.

Convert your Photoshop designs to code with AI.

## Installation

```bash
# Add to Claude Code (recommended)
claude mcp add psd-parser -- npx -y psd-mcp-server

# Or with bunx
claude mcp add psd-parser -- bunx psd-mcp-server
```

## MCP Configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "psd-parser": {
      "command": "npx",
      "args": ["-y", "psd-mcp-server"]
    }
  }
}
```

### Cursor

`.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "psd-parser": {
      "command": "npx",
      "args": ["-y", "psd-mcp-server"]
    }
  }
}
```

## Features

### Layer Analysis

| Tool | Description |
|------|-------------|
| `parse_psd` | Parse entire PSD structure with all layer info |
| `list_layers` | List layers as tree structure (with depth limit) |
| `get_layer_by_name` | Find layer by name with detailed info |
| `get_layer_children` | Get children of a group layer |
| `get_text_layers` | Extract text layers with font info |

### Asset Export

| Tool | Description |
|------|-------------|
| `export_images` | Export image layers as PNG/JPG (@2x default) |
| `export_layer_image` | Export single layer by name (with layerIndex for duplicates) |
| `list_vector_layers` | List all vector/shape layers |
| `export_vector_as_svg` | Export single vector layer as SVG |
| `export_all_vectors_as_svg` | Export all vectors as SVG files |

### Design Tokens

| Tool | Description |
|------|-------------|
| `extract_colors` | Extract all colors (fills, strokes, shadows, gradients) |
| `list_fonts` | List fonts with sizes, styles, and CSS template |

### Smart Objects

| Tool | Description |
|------|-------------|
| `list_smart_objects` | List Smart Objects with type and linked file info |
| `get_smart_object_content` | Read embedded PSD inside Smart Object |

## Usage Examples

### Basic Analysis

```
Analyze ~/Desktop/design.psd and list all text layers
```

### Export Assets

```
Export all images from the "icons" group in ~/Desktop/ui.psd to ./assets/
```

### Extract Design Tokens

```
Extract colors from ~/Desktop/design.psd and output as CSS variables
```

## Output Examples

### list_fonts (css format)

```css
@font-face {
  font-family: 'Inter';
  src: url('./fonts/Inter.woff2') format('woff2');
  font-weight: normal;
  font-style: normal;
}

:root {
  --font-size-1: 14px;
  --font-size-2: 18px;
  --font-size-3: 24px;
  --font-size-4: 64px;
}
```

### extract_colors (css format)

```css
:root {
  --color-1: #1A1A1A;
  --color-2: #666666;
  --color-3: #007AFF;

  --gradient-1: linear-gradient(90deg, #FF6B6B, #4ECDC4);
}
```

## Limitations

- Layer effects (drop shadow, bevel) are extracted as colors but not fully styled
- Complex blend modes not supported
- Linked Smart Objects require the linked file to be present

## License

MIT
