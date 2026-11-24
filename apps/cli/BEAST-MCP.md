# Beast Downloader by RV: MCP

The local stdio MCP server uses the existing authenticated desktop automation API. It exposes queue status, URL addition, metadata fetch, per-item and explicit bulk settings, starting and cancelling chosen rows, in-app preview descriptors, one-item downloads with optional clip ranges, file verification and a Windows desktop startup command. Open Beast normally or call `beast_start_desktop`; startup failures require inspection, and the server does not silently change OS or app security settings.

For the packaged Windows app, configure an MCP-compatible host with a command like:

```json
{
  "mcpServers": {
    "beast-downloader": {
      "command": "C:\\Users\\USER\\AppData\\Local\\Programs\\beast-downloader\\resources\\resources\\node\\node.exe",
      "args": ["C:\\Users\\USER\\AppData\\Local\\Programs\\beast-downloader\\resources\\beast-agent\\beast-mcp.mjs"]
    }
  }
}
```

Replace `USER` with the Windows account name and adapt configuration to the host. Installing the app does not automatically register it with arbitrary MCP clients. The desktop must be accessible from the host's process environment; restricted sandbox sessions may not see the desktop process or its loopback port.

Use `tools/list` for exact schemas. Add URLs with `beast_add`, fetch returned IDs, check status and use `beast_configure` or `beast_configure_many`, then `beast_start`. These operations use Beast's existing formats, trims and validation. Poll status before retrying any timed-out action; do not blindly repeat mutations. `beast_preview` returns the app-internal `batch-media://` descriptor, not a downloadable internet link. `beast_download_one` chooses at most 1080 on the shorter side, verifies local streams and returns source information; record rights independently. The built-in browser companion and settings remain the supported login path; never transmit credentials through MCP arguments.

`beast_prepare_premiere` validates a video file and source range and returns a handoff with the requested sequence, track and position; it does not write to Premiere. This server does not expose global app settings, automatic permission acquisition, all Beast controls, or direct Premiere timeline placement. Use the separately connected RAVIX Studio Premiere tools to inspect the active sequence and empty tracks, import and place the media. A URL and a successful download do not establish reuse rights.
