# psd-mcp-server

MCP Server for parsing PSD files and extracting layer information for LLM coding assistance.

Convert your Photoshop designs to code with AI.

## Installation

    # Add to Claude Code (recommended)
    claude mcp add psd-parser -- bunx psd-mcp-server

    # Or with npx
    claude mcp add psd-parser -- npx -y psd-mcp-server

## MCP Configuration

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

    {
      "mcpServers": {
        "psd-parser": {
          "command": "bunx",
          "args": ["psd-mcp-server"]
        }
      }
    }

### Cursor

`.cursor/mcp.json`:

    {
      "mcpServers": {
        "psd-parser": {
          "command": "bunx",
          "args": ["psd-mcp-server"]
        }
      }
    }

## Features

| Tool               | Description                                               |
| ------------------ | --------------------------------------------------------- |
| `parse_psd`        | Parse entire PSD structure                                |
| `get_text_layers`  | Extract text layers only                                  |
| `get_hero_section` | Auto-categorize for hero section (heading/subheading/CTA) |

### Extracted Information

- Document size (width/height)
- Layer hierarchy
- Text content, font, size, color
- Layer position and bounds

## Usage

    Use get_hero_section to analyze ~/Desktop/design.psd,
    then create a React + Tailwind component

### Output Example

    {
      "documentSize": { "width": 1440, "height": 900 },
      "heading": {
        "text": {
          "content": "Welcome to Our Platform",
          "font": "Inter",
          "fontSize": 64,
          "color": "#1a1a1a"
        },
        "bounds": { "left": 120, "top": 200, "width": 600, "height": 80 }
      },
      "subheading": {
        "text": { "content": "Build something amazing", "fontSize": 24 }
      },
      "cta": [...]
    }

## Limitations

- Image layer export not supported (export separately)
- Complex layer effects not available
- Smart objects treated as flat layers

## License

MIT
