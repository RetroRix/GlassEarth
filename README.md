<div align="center">

# 🌍 Glass Earth

### The live planet on one globe

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MapLibre](https://img.shields.io/badge/MapLibre_GL-GPU_Rendered-396CB2?style=for-the-badge)](https://maplibre.org)
[![License](https://img.shields.io/badge/License-MIT-D4AF37?style=for-the-badge)](LICENSE)

**The live planet on one globe: live flight tracking, satellites, worldwide CCTV networks, earthquakes, wildfires, severe weather and 24/7 news feeds in a single GPU-accelerated interface — plus your own aircraft.**

[Report Bug](https://github.com/RetroRix/GlassEarth/issues) · [Request Feature](https://github.com/RetroRix/GlassEarth/issues)

Based on [OSIRIS](https://github.com/simplifaisoul/osiris) by simplifaisoul (MIT). Glass Earth drops the upstream RECON/scanning toolkit, Telegram scraping, sanctions screening, crypto-wallet tracing and conflict-zone layers, and keeps everything else.

</div>

---

## Screenshots

<p align="center">
  <img src="docs/screenshots/taiwan-cctv.jpg" alt="Glass Earth over Taipei on the Night map, with live traffic-camera previews pinned across the city and the Longmen Building rooftop feed open" width="100%">
  <br><sub><b>Taiwan</b> — Taipei's public traffic cameras streaming live on the Night map, one feed open full-size</sub>
</p>

<p align="center">
  <img src="docs/screenshots/seoul-live-cctv.jpg" alt="Glass Earth over Seoul in 3D terrain around Namsan Tower, with live CCTV previews and the Cheonggyecheon feed open" width="100%">
  <br><sub><b>Seoul</b> — live CCTV in 3D terrain around Namsan Tower, with the Cheonggyecheon feed playing</sub>
</p>

<p align="center">
  <img src="docs/screenshots/save-an-area.jpg" alt="A drawn area over mountain terrain in Glass Earth, with the live cameras inside it and the Drawing Tools panel showing the saved area" width="100%">
  <br><sub><b>Save an Area</b> — draw a region and Glass Earth finds every camera inside it, ready to export as GeoJSON</sub>
</p>

---

## Overview

Glass Earth is a live-planet dashboard that provides situational awareness across multiple domains. Built with Next.js 16 and MapLibre GL, every data point is rendered via WebGL for 60fps performance even with thousands of concurrent entities on-screen.

### Key Capabilities

| Domain | Data Points | Sources |
|--------|------------|---------|
| **Aviation** | Commercial, Private, Military, Jets | OpenSky Network |
| **Maritime** | 39 Global Ports, 10 Chokepoints | Static Naval Intel |
| **CCTV** | 17,000+ Cameras | TfL, WSDOT, Caltrans, ODOT, MDOT, HK Transport Dept, Taiwan THB, NZTA, Rijkswaterstaat, [Public Webcams](#acknowledgements) + more |
| **Seismic** | Real-time M2.5+ | USGS Earthquake API |
| **Fires** | Active Hotspots | NASA FIRMS |
| **News** | 24/7 Live Streams | 23 Global Broadcasters |
| **Weather** | Severe Events | NASA EONET |
| **Space** | Solar Weather, Satellites | NOAA SWPC, N2YO |
| **Cyber** | CVE Threats, Vulnerability Scanning | NVD, Custom Scanner |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│               GLASS EARTH CLIENT                │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐ │
│  │ MapLibre  │  │  HUD     │  │  OI Assistant │ │
│  │  GL (GPU) │  │ Panels   │  │  Assistant    │ │
│  │  WebGL    │  │ Layers   │  │  Forecasts    │ │
│  │  Render   │  │ Controls │  │  Predictions  │ │
│  └──────────┘  └──────────┘  └───────────────┘ │
├─────────────────────────────────────────────────┤
│               NEXT.JS API ROUTES                 │
│  /api/flights         /api/earthquakes          │
│  /api/cctv            /api/news                 │
│  /api/fires           /api/maritime             │
│  /api/gdelt           /api/satellites           │
│  /api/weather         /api/transit              │
│  /api/sentinel        /api/oi                   │
├─────────────────────────────────────────────────┤
│              EXTERNAL DATA SOURCES               │
│  OpenSky · USGS · NASA · NOAA · TfL · NVD      │
│  GDACS · EONET · FIRMS · N2YO · RSS Feeds      │
└─────────────────────────────────────────────────┘
```

---

## Features

### Intelligence Layers
- **16 toggleable data layers** with real-time entity counts
- **GPU-accelerated rendering** — all map data rendered via WebGL, not DOM
- **Progressive loading** — data fetched on-demand when layers are activated
- **Viewport-aware** — only loads relevant data for the visible region

### OI — a prediction engine (bring your own key)
**OI Assist**: talk to the map (press O). Ask in words, typed or spoken, and OI flies you there, switches the layers on, finds what is live (flights, military aircraft, ships, quakes, fires, weather, news, cameras, satellites), marks it on the globe in cyan with the area it searched, lists it in cards you can click through, reads the markets, opens panels and starts forecasts, all on your own model key.

**OI Forecast**: a prediction engine inspired by the community-made [Pythia](https://github.com/jangles-byte/Pythia) and by [MiroFish](https://github.com/666ghj/MiroFish). From Pythia comes the idea of forecasting from the live world Glass Earth already watches; from MiroFish, the method: cast the actors who shape an outcome and play them against each other in parallel simulated worlds. Ask a question and OI researches it from sources you can check (news, prices, prediction markets and the live feeds), runs the worlds, and has a report agent weigh the result against the crowd's price and a statistical baseline before it writes a calibrated forecast, every claim linked to its source. The whole run plays out on the globe as it happens.
- **Your own data**: add files (CSV, JSON, Markdown, text, logs, web pages) or paste up to 100,000 characters. The world model reads it once; or have every actor read it in every period, and quote it. The extra input tokens are shown before you run, on your own key.
- **Your own key**: OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, xAI, Mistral or Qwen. Kept in your browser, sent per request in a header, never stored on the server.
- **REST API** under `/api/oi` with live Server-Sent Events, and an **MCP server** at `/api/mcp` so agents such as Hermes, Claude and Cursor can run predictions, steer them and read Glass Earth intelligence. See the in-app docs at `/docs`.

### Texas CCTV
Public TxDOT ITS snapshots are integrated with the existing camera markers, preview grid and viewer. Use `/api/cctv?region=texas` for Texas only; global and Texas location queries include the same source. District inventories are cached independently, with stale data retained during outages. Availability varies by district and camera; these are refreshing JPEG snapshots, not video streams.

Source: [TxDOT ITS](https://its.txdot.gov/its/District/DAL/cameras).

Run `npm test` for offline checks or `RUN_LIVE_TESTS=1 npx vitest run src/app/api/cctv/texas.test.ts` to check the public Texas inventory.

### Live Broadcast Network
- **23 live 24/7 news streams** from global broadcasters
- Click any news dot on the map to open the live stream
- Feeds from NBC, CBS, ABC, Sky News, Al Jazeera, France 24, NHK, WION, and more

### Performance Optimized
- **75% reduction in edge requests** vs initial release
- Aggressive polling relaxation (15-30 min intervals for stable data)
- Static data served from memory (zero external API calls for news feeds)
- `layerFetchedRef` prevents duplicate API requests

---

## Quick Start

```bash
git clone https://github.com/RetroRix/GlassEarth.git
cd GlassEarth
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Docker / Self-Hosting

```bash
git clone https://github.com/RetroRix/GlassEarth.git
cd GlassEarth
cp .env.example .env     # optional — configure keys / port
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000). The image is a multi-stage
`node:22-alpine` standalone build (~220 MB, non-root). The compose file also
carries CasaOS app metadata (`x-casaos:`) for one-click install on
[CasaOS](https://casaos.io). See **[DOCKER.md](DOCKER.md)** for the full Docker,
CasaOS and API-key guide.

**Prebuilt image** — no prebuilt image is published for the Glass Earth fork yet; build from source with the compose file above.

**Custom port** — the container always listens on `3000`; set `OSIRIS_PORT` in
`.env` to change the published host port (e.g. `OSIRIS_PORT=3005`) without
editing the compose file.

### Environment Variables

Glass Earth works **without any API keys** — all core feeds use public,
keyless sources. Copy [`.env.example`](.env.example) to `.env` and set only
what you need:

```env
# Published host port (container always listens on 3000). Default: 3000
OSIRIS_PORT=3000

# Optional, for higher rate limits / future sources (see DOCKER.md for signup links)
FIRMS_API_KEY=                # NASA FIRMS  — firms.modaps.eosdis.nasa.gov/api/map_key/
OPENSKY_CLIENT_ID=            # OpenSky OAuth2 (since Mar 2025) — opensky-network.org
OPENSKY_CLIENT_SECRET=
N2YO_API_KEY=                 # N2YO satellites — n2yo.com (Profile → API key)
AIS_API_KEY=                 # aisstream.io maritime
```

> Every layer works out of the box with no keys. `.env` is gitignored — only the template is committed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 |
| Map Engine | MapLibre GL JS (WebGL) |
| Animations | Framer Motion |
| Icons | Lucide React |
| Styling | Custom CSS Design System |
| Deployment | Vercel Edge Network |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `F` | Toggle flight layers |
| `E` | Toggle earthquakes |
| `S` | Toggle satellites |
| `D` | Toggle day/night cycle |
| `Escape` | Close panels |

---

## Acknowledgements

**Public webcams** — the cameras in this layer are open data: each one is broadcast
publicly by whoever runs it, on their own site or their own channel. What the web
lacked was a catalogue of them.

[bekijkhet.nu](https://www.bekijkhet.nu/) is that catalogue, and it is the basis for
every camera in the layer. Bram and Annelies have kept it by hand since 2012, and
without their index these cameras would still be scattered across several hundred
unrelated sites with no way to find them.

Glass Earth links every one of them straight through to the operator who runs it, which is
also how bekijkhet.nu asks to be read.

**OI** — the method behind OI follows [MiroFish](https://github.com/666ghj/MiroFish),
the open-source swarm-intelligence prediction engine: seed a parallel world from real
material, populate it with agents, let them interact while variables are injected, and
hand the simulation to a report agent. Glass Earth rebuilds that method natively for its own
feeds and globe; no MiroFish code is used.

---

## License

MIT — see [LICENSE](LICENSE) for details. Glass Earth is based on the OSIRIS project by simplifaisoul, whose MIT copyright and license notice are preserved in [LICENSE](LICENSE).

---

<div align="center">

**Built by [RetroRix](https://github.com/RetroRix) · Based on [OSIRIS](https://github.com/simplifaisoul/osiris) by simplifaisoul (MIT)**

</div>
