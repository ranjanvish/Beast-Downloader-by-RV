# 🚀 Beast Downloader by RV (v3.1.24 Latest)

<div align="center">
  <img src="apps/desktop/build/icon.png" alt="Beast Downloader by RV Logo" width="115" height="115">
  <br />
  <h3><b>Beast Downloader by RV</b></h3>
  <p><b>Next-Generation High-Speed Video/Audio/Image Downloader, Local AI Transcription & Autonomous Agent Workstation</b></p>

  <p>
    <a href="https://github.com/ranjanvish/Beast-Downloader-by-RV/releases/latest"><img src="https://img.shields.io/github/v/release/ranjanvish/Beast-Downloader-by-RV?color=00c853&labelColor=202124&logo=github&label=Release" alt="Latest Release" /></a>
    <a href="https://github.com/ranjanvish/Beast-Downloader-by-RV/releases"><img src="https://img.shields.io/github/downloads/ranjanvish/Beast-Downloader-by-RV/total?color=2979ff&labelColor=202124&logo=github&label=Downloads" alt="Total Downloads" /></a>
    <a href="https://github.com/ranjanvish/Beast-Downloader-by-RV/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-f59e0b?labelColor=202124" alt="License" /></a>
    <a href="https://github.com/ranjanvish/Beast-Downloader-by-RV"><img src="https://img.shields.io/badge/Platform-Windows%20x64-blue?labelColor=202124&logo=windows" alt="Windows x64" /></a>
  </p>

  <p>
    <a href="https://github.com/ranjanvish/Beast-Downloader-by-RV/releases/download/v3.1.24/Beast-Downloader-by-RV-3.1.24-Setup.exe">
      <img src="https://img.shields.io/badge/📥%20Download%20Installer-v3.1.24%20Windows%20x64%20(Setup.exe)-success?style=for-the-badge" alt="Download Windows Installer" />
    </a>
  </p>
</div>

---

## ⚡ Overview

**Beast Downloader by RV (v3.1.24)** is a studio-grade media extraction, processing, and automation workstation built for video editors, AI creators, and media archivists. It combines raw multi-threaded downloading from 1000+ streaming and social platforms with on-device local AI speech recognition, loss-free video trimming, an autonomous **MCP Server & Agent Bridge**, and seamless Adobe Premiere Pro (RAVIX Studio) workflow handoffs.

Built on modern **Electron 43**, **React 19**, **Tailwind CSS**, and **Drizzle SQLite**, Beast Downloader brings complete control over media extraction and analysis right to your desktop.

<div align="center">
  <img src="screenshots/downloads-framed.webp" alt="Beast Downloader Queue" width="48%" />
  <img src="screenshots/transcript-framed.webp" alt="Beast Downloader AI Transcript" width="48%" />
</div>

---

## 🌟 What's New & Upgraded in v3.1.24

### 🤖 1. Local Stdio MCP Server (`apps/cli/BEAST-MCP.md`)
- Directly integrates with AI coding agents (such as Antigravity, Claude Code, Cursor, and Windsurf) via the Model Context Protocol (MCP).
- Exposes structured tools to query queue status, fetch metadata, configure download options, trigger batch operations, generate in-app previews, and initiate one-item downloads with precise timestamps:
  - `beast_start_desktop`
  - `beast_add`
  - `beast_configure` / `beast_configure_many`
  - `beast_start`
  - `beast_preview`
  - `beast_download_one`
  - `beast_prepare_premiere`

### 🎞️ 2. Adobe Premiere Pro RAVIX Studio Handoff
- Dedicated `beast_prepare_premiere` bridge that validates video files and source clipping ranges, returning a structured handoff with target sequences, empty video tracks, and timeline positions for instant editing.

### 🌉 3. Beast Agent Bridge & CLI (`apps/cli/BEAST-AGENT.md`, `beast.cmd`)
- Programmatic CLI and automated scripting interface using Beast Desktop's authenticated loopback batch API.
- Emits comprehensive JSON manifests recording source URLs, reported rights, exact measured media streams, dimensions, and durations.

### 🔥 4. Instant Local Updates Engine
- **FastBuild & Hot Reloading** (`FastBuild.cmd`, `WatchUpdates.ps1`): Replaces compiled application code (`app.asar`) in seconds without reinstalling the entire Electron runtime or terminating running background downloads.
- **Fail-safe Rollback**: Automatically verifies builds, updates patch versions, and preserves installed working code if any validation check fails.

### 🎬 5. Unified Beast Download Workspace
- **SingleVideoBeast**: Dedicated precision inspector for high-resolution video streams (4K/8K 60fps), audio dub tracks, and metadata.
- **BeastClip**: Precision interactive timeline trimming. Download only the exact seconds/minutes you need without fetching multi-gigabyte source files.
- **AllInOneDownloads**: Unified multi-tab queue orchestrating video, audio, and image tasks in parallel.

### 🖼️ 6. Batch Image Downloader & Converter
- Built-in crawler extracting high-resolution images from supported galleries, web pages, and social media.
- Integrated **ImageMagick** conversion engine allowing instant WebP, PNG, and JPG optimization and format conversions.

### 🌐 7. Zero-Loss Multi-Language Audio Stream Selection
- Accurately captures separate audio dub tracks (Hindi, English, Spanish, Japanese, etc.) and muxes them seamlessly into MP4 or MKV containers.
- Enhanced UTF-8 preservation layer keeps international and Indic characters intact without filename corruption.

### 🎙️ 8. On-Device Local AI Speech Transcription
- Integrated speech-to-text models that run 100% locally with zero subscription costs or cloud latency:
  - **Whisper** (tiny, base, small, medium, large-v3)
  - **SenseVoice** & **Parakeet**
  - **Qwen3-ASR**
- Automatic speaker diarization, clickable timestamp jump, and SRT/VTT/Markdown export.

### 🧩 9. Browser Extension Companion (Chrome / Brave / Edge)
- Built on modern Manifest V3 (WXT) with instant media overlay detection.
- Send active video, audio, or image galleries from your browser into Beast Downloader in a single click.

---

## 📥 Installation

### Option A: One-Click Windows Setup (Recommended)
1. Go to the [Latest Release (v3.1.24)](https://github.com/ranjanvish/Beast-Downloader-by-RV/releases/tag/v3.1.24).
2. Download **`Beast-Downloader-by-RV-3.1.24-Setup.exe`**.
3. Run the installer to install or upgrade Beast Downloader.

### Option B: Build from Source

#### Prerequisites
- **Node.js**: v24.x or v22.x LTS
- **pnpm**: v11.1.2 or higher (`npm install -g pnpm@11.1.2`)
- **Git**

#### Steps
```bash
# 1. Clone repository
git clone https://github.com/ranjanvish/Beast-Downloader-by-RV.git
cd Beast-Downloader-by-RV

# 2. Install workspace dependencies
pnpm install --node-linker=hoisted

# 3. Build the browser extension companion
pnpm --filter vidbee-extension build

# 4. Run the regression and agent test suite
node --test apps/desktop/scripts/test-beast-regressions.cjs
node --test apps/desktop/scripts/test-agent-update.cjs

# 5. Build & Launch in development mode
pnpm --filter beast-downloader dev

# 6. Package Windows NSIS x64 Installer
pnpm --filter beast-downloader build:win
```

---

## 🔌 MCP Server Configuration (For AI Agents)

Add the following to your AI client's MCP configuration (`settings.json` / `mcp.json`):

```json
{
  "mcpServers": {
    "beast-downloader": {
      "command": "C:\\Users\\<USER>\\AppData\\Local\\Programs\\beast-downloader\\resources\\resources\\node\\node.exe",
      "args": [
        "C:\\Users\\<USER>\\AppData\\Local\\Programs\\beast-downloader\\resources\\beast-agent\\beast-mcp.mjs"
      ]
    }
  }
}
```

*(Replace `<USER>` with your Windows username).*

---

## 🏛️ Monorepo Architecture

```text
Beast-Downloader-by-RV/
├── apps/
│   ├── cli/              # MCP server (beast-mcp.mjs), agent bridge (beast-agent.mjs), and CLI wrapper
│   ├── desktop/          # Electron 43 + React 19 desktop workstation (v3.1.24)
│   ├── extension/        # Browser companion extension (Chrome / Brave / Edge MV3)
│   ├── api/              # Fastify headless API server with oRPC & SSE
│   ├── web/              # TanStack Start web interface
├── packages/
│   ├── downloader-core/  # yt-dlp & FFmpeg execution wrapper + editor-video pipeline
│   ├── transcription/    # Local AI ASR engine (Whisper, SenseVoice, sherpa-onnx)
│   ├── task-queue/       # Robust job classifier & priority queue
│   ├── subscriptions-core/# RSS parser and feed coordinator
│   ├── db/               # Drizzle ORM schema & SQLite migration layer
│   ├── logger/           # Structured logging
│   └── ui/               # Shared Radix UI & Tailwind component library
├── FastBuild.cmd         # Quick 1-click local development build & hot-update
├── WatchUpdates.ps1      # Background source watcher for seamless updates
└── screenshots/          # Application previews and UI captures
```

---

## 🛠️ Technology Stack

- **Desktop Framework**: Electron 43, Node.js 24
- **Frontend**: React 19, TypeScript, Tailwind CSS, Lucide Icons, Shadcn UI
- **Database**: SQLite with Drizzle ORM
- **Media Engine**: yt-dlp, FFmpeg, ImageMagick
- **ASR AI Engine**: sherpa-onnx, whisper.cpp, fast-whisper
- **Autonomous Agents**: Stdio MCP Server protocol, Agent Bridge JSON manifests
- **Packager**: electron-builder 26, NSIS 3.12

---

## 🤝 Credits & Acknowledgements

- Built upon the foundation of [VidBee](https://github.com/nexmoe/VidBee) by nexmoe.
- Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/).
- Customized & maintained by **RV (Ranjan Vishwakarma)**.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
