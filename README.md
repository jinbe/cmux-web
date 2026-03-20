# cmux-web

A web-based terminal multiplexer — cmux for the browser.

Split panes, multiple workspaces, resizable layouts — all running in your browser with real PTY sessions on the backend. Includes a cmux-compatible CLI for scripting and automation.

## Quick Start

```bash
npm install
npm run dev
```

Then open http://localhost:7681 in your browser.

## Architecture

```
┌─────────────────────────────────────┐
│           Browser (Frontend)         │
│  ┌──────────┐  ┌──────────┐        │
│  │ xterm.js │  │ xterm.js │        │
│  │  Pane 1  │  │  Pane 2  │        │
│  └────┬─────┘  └────┬─────┘        │
│       └──── WebSocket ──────┐       │
└─────────────────────────────┼───────┘
                              │
┌─────────────────────────────┼───────┐
│           Server (Node.js)   │       │
│       ┌─────────────────────┘       │
│       │  Session Manager            │
│  ┌────┴────┐  ┌─────────┐          │
│  │  PTY 1  │  │  PTY 2  │  ...     │
│  └─────────┘  └─────────┘          │
│                                     │
│  CLI Socket (/tmp/cmux-web.sock)    │
└─────────────────────────────────────┘
```

### Components

- **Server** (`src/server/`) — Express + WebSocket server, PTY manager, session manager
- **Client** (`public/`) — Vanilla JS with xterm.js, split layout renderer, mobile-friendly
- **CLI** (`src/cli/`) — Commander-based CLI that talks to the Unix domain socket
- **Shared** (`src/shared/`) — Protocol types shared between server and CLI

## Mobile Support

Works on phones and tablets out of the box:

- **Slide-over sidebar** — swipe right from the left edge to open
- **Single-pane mode** on small screens with swipe between surfaces
- **Touch-draggable** resize handles
- **Mobile toolbar** with workspace name, surface pips, and actions menu
- **Safe area** support for notched devices
- **PWA-ready** — add to home screen for a native app feel

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+N` | New workspace |
| `Ctrl+1–9` | Switch workspace by number |
| `Ctrl+Shift+D` | Split right |
| `Ctrl+Shift+E` | Split down |
| `Ctrl+Shift+W` | Close focused surface |
| `Escape` | Close sidebar / actions menu |

## CLI Usage

The CLI talks to the cmux-web server via a Unix domain socket at `/tmp/cmux-web.sock`, using the same JSON protocol as cmux v2.

```bash
# Check server is running
npm run cli -- ping

# Workspace management
npm run cli -- workspace list
npm run cli -- workspace create --name "My Project"
npm run cli -- workspace select <id>
npm run cli -- workspace close <id>

# Surface (pane) management
npm run cli -- surface list
npm run cli -- surface split <surfaceId> --direction right
npm run cli -- surface split <surfaceId> --direction down
npm run cli -- surface close <surfaceId>
npm run cli -- surface send-text <surfaceId> "echo hello"

# Quick split (uses current workspace)
npm run cli -- split --direction down
```

## cmux Compatibility

The CLI socket speaks the same newline-delimited JSON protocol as cmux v2:

```json
{"id":"1","method":"workspace.list","params":{}}
{"id":"1","ok":true,"result":{"workspaces":[...]}}
```

Existing cmux integrations (like pi-cmux) can be adapted to talk to cmux-web by pointing `CMUX_SOCKET_PATH` at `/tmp/cmux-web.sock` (or `CMUX_WEB_SOCKET_PATH`).

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CMUX_WEB_PORT` | `7681` | HTTP/WebSocket server port |
| `CMUX_WEB_SOCKET_PATH` | `/tmp/cmux-web.sock` | CLI control socket path |

## Licence

MIT
