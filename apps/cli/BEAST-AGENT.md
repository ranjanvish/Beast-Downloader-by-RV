# Beast agent bridge

`beast-agent.mjs` uses Beast Desktop's authenticated loopback batch API, including its image scanner and shared queue. It does not bypass login, make an independent download, or alter existing queue entries.

Start Beast Desktop and ensure its descriptor and local API are available. Node 20+ and `ffprobe` on PATH are required.

```sh
node beast-agent.mjs status
node beast-agent.mjs download request.json
```

Example request (use absolute Windows paths in JSON, with backslashes escaped):

```json
{
  "url": "https://example.org/video",
  "output": "video",
  "folder": "C:\\Media\\Project",
  "manifest": "C:\\Media\\Project\\source-001.json",
  "start": 20,
  "end": 30,
  "publisher": "Known publisher",
  "rights": "permission pending"
}
```

`output` is `image`, `audio`, or `video`. `start` and `end` are optional seconds and must be provided together; images cannot be trimmed. For video, the bridge chooses the best known dimensions whose smaller side is at most 1080. Image output uses Beast's image scanner. Audio uses Beast's current default audio output. The manifest records the source, reported rights, queue ID, path, measured streams, dimensions and duration. Rights are caller-supplied and never independently verified by this tool. A manifest path must not already exist.

Each request enqueues a new unique row. A duplicate is rejected instead of downloading again; inspect `status` and the Beast UI. If a request times out or a connection drops, inspect the queue before attempting anything again. This tool does not auto-retry an uncertain mutation. It does not yet provide automatic desktop startup repair, site-specific authentication, bulk control, sequence placement, independent licence checks, or graphical review. A successful queue result alone does not verify semantic footage relevance.

Validation: `node --test test/agent-bridge.test.mjs` in this development copy; actual integration checks require a running desktop and authorised sample URLs.
