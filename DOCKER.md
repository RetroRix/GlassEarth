# Self-Hosting Glass Earth with Docker

Glass Earth ships as a self-contained Next.js standalone build. This guide covers
running it with Docker / Docker Compose, deploying it as a [CasaOS](https://casaos.io)
app, and configuring the optional API keys.

> **TL;DR:** Glass Earth runs fully **without any API keys**. All core feeds
> (aviation, satellites, fires, earthquakes, weather, news, CVEs) use public
> keyless sources. Keys only matter for the optional RECON scanner backend and
> for raising rate limits on a few feeds.

---

## 1. Docker Compose (recommended)

```bash
git clone https://github.com/simplifaisoul/osiris.git
cd osiris

# optional: configure keys / scanner backend
cp .env.template .env        # then edit .env

docker compose up -d
```

Open <http://localhost:3000>.

What the compose file does:

- **`build:`** — compose builds the image locally from the `Dockerfile`, so
  you always run the code you just cloned. To run the prebuilt registry image
  instead, add `image: <your-registry>/glassearth:latest` to the `osiris`
  service and drop the `build:` block.
- **`env_file: .env` (`required: false`)** — if a `.env` file exists its
  values are injected into the container; if it's missing, Glass Earth still starts
  with the keyless feeds.
- **`ports: ${OSIRIS_PORT:-3000}:3000`** — the web UI. The container always
  listens on 3000; the published **host** port is `OSIRIS_PORT` (default
  `3000`). Set `OSIRIS_PORT` in `.env` to remap it, e.g. `OSIRIS_PORT=3005`
  when 3000 is already in use — no need to edit the compose file.
- **`restart: unless-stopped`** — survives reboots.

Common commands:

```bash
docker compose logs -f          # follow logs
docker compose up -d --build    # rebuild locally after pulling new code
docker compose down             # stop & remove
```

### Prebuilt images

No prebuilt image is published for the Glass Earth fork yet — build from source with the compose file above.

---

## 2. CasaOS

The compose file includes an `x-casaos:` metadata block (title, description,
icon, port map, env descriptions) that plain Docker Compose ignores but CasaOS
reads.

**Install:**

1. On the CasaOS host, clone the repo somewhere persistent (e.g.
   `/DATA/AppData/osiris`).
2. CasaOS dashboard → **`+`** → **Install a customized app** → paste the
   contents of `docker-compose.yml`.
   *(or simply run `docker compose up -d` from the cloned directory).*
3. Glass Earth appears on the dashboard with its icon, reachable on host port
   `3000` (or whatever `OSIRIS_PORT` you set in `.env`).

The app icon is the gold Eye-of-Horus mark in
`public/casaos-icon.png` (512×512 PNG), referenced by the `icon:` URL in the
metadata.

> CasaOS stores imported compose files under `/var/lib/casaos/apps/`, so a
> relative `build:` context may not resolve there. If importing the YAML
> directly, either build/tag `osiris:latest` first
> (`docker build -t glassearth:latest /path/to/GlassEarth`) or replace the `build:`
> block with `image: <your-registry>/glassearth:latest`.

---

## 3. API keys & data sources

Copy `.env.template` to `.env` and fill in only what you need.

### What the code actually reads today

No environment variable is required: every core feed is keyless. The optional
keys below only raise rate limits or enable extra sources.

### Optional keys (reserved / for higher rate limits)

These are documented for completeness and forward-compatibility. The current
data routes use **keyless** public feeds, so these are not consumed yet — set
them only if you extend the relevant route or hit rate limits.

| Variable | Service | How to get it (all free) |
|----------|---------|--------------------------|
| `FIRMS_API_KEY` | NASA FIRMS active fires | Enter an email at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> — the `MAP_KEY` is emailed instantly. Limit 5000 req / 10 min. |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | OpenSky aviation | Create an account at <https://opensky-network.org/>, open **Account → API client**, create a client and copy id/secret. **OAuth2 only since March 2025** (username/password auth removed). |
| `N2YO_API_KEY` | N2YO satellites | Register at <https://www.n2yo.com/login/register/>, then **Profile → generate API key**. Limit 1000 req / hour; key can't be regenerated. |
| `AIS_API_KEY` | aisstream.io maritime | Sign up at <https://aisstream.io/>, create a key on the **API Keys** page. Used over `wss://stream.aisstream.io/v0/stream`. |

### Optional keys for Live Transit

The **Live Buses & Transit** layer needs no key: it reads 185 operators' own
GTFS-Realtime feeds, including all of Great Britain and New York City. Each
variable below adds an operator that publishes only behind a free sign-up. The
key stays on the server; without it that operator is simply not shown.

| Variable | Adds | Get a key |
|----------|------|-----------|
| `TRANSIT_WMATA_KEY` | Washington DC Metrobus and Metrorail | <https://developer.wmata.com/> |
| `TRANSIT_511_KEY` | San Francisco Bay Area, every operator | <https://511.org/open-data/token> |
| `TRANSIT_TRIMET_KEY` | Portland TriMet | <https://developer.trimet.org/appid/registration/> |
| `TRANSIT_TRANSLINK_KEY` | Vancouver TransLink | <https://developer.translink.ca/> |
| `TRANSIT_STM_KEY` | Montréal STM | <https://portail.developpeurs.stm.info/> |
| `TRANSIT_NTA_KEY` | All of Ireland | <https://developer.nationaltransport.ie/> |
| `TRANSIT_TRAFIKLAB_KEY` | Stockholm SL | <https://developer.trafiklab.se/> |
| `TRANSIT_TFNSW_KEY` | Sydney buses, trains, metro, ferries and light rail | <https://opendata.transport.nsw.gov.au/> |
| `TRANSIT_METLINK_KEY` | Wellington Metlink | <https://opendata.metlink.org.nz/> |
| `TRANSIT_AT_KEY` | Auckland Transport | <https://dev-portal.at.govt.nz/> |

A refused key shows as "key refused" on that operator in `/api/transit`.

> Keep `.env` out of version control — it is already in `.gitignore`. Only
> `.env.template` (no secrets) is committed.

### Optional runtime overrides

| Variable | Purpose | Default |
|----------|---------|---------|
| `OSIRIS_PORT` | Host port the compose file publishes (container itself always listens on 3000). | `3000` |

### Keyless sources (no configuration needed)

Aviation → `adsb.lol` · Satellites → `celestrak.org` (TLE) · Fires →
NASA FIRMS open-data CSV · Earthquakes → USGS · Weather → NASA EONET · Space
weather → NOAA SWPC · CVEs → NVD · News → public RSS / HLS streams · CCTV →
public traffic-authority feeds · Crypto (BTC) → `blockstream.info` · Crypto
(ETH) → `eth.blockscout.com` ([Blockscout](https://github.com/blockscout/blockscout)
open-source explorer) · OFAC SDN sanctions → [OpenSanctions](https://www.opensanctions.org)
mirror (CC-BY 4.0) · Telegram OSINT → public `t.me/s/<channel>` web preview.
