/**
 * Glass Earth — plane-spotting catalogue.
 *
 * A handful of the world's great 24/7 airport cameras, curated rather than
 * scraped: each entry below was checked by hand (October 2026) — the stream
 * is genuinely live around the clock, and its owner permits YouTube embeds.
 * That is why the catalogue is small and why it is data: adding an airport
 * is one entry here, and removing a dead one is one deletion.
 *
 * Players embed by *video id*, not by channel: the Flightradar24 channel
 * runs several airport streams at once, so a channel-level live embed would
 * pick one arbitrarily. The cost of a video id is that a stream restart
 * changes it — the panel detects a dead player (YouTube's onError
 * handshake) and falls back to a watch-on-YouTube card, and the fix is
 * updating the id here.
 *
 * LiveATC is a link, always: it does not permit hotlinking or embedding its
 * audio. `liveAtcUrl` builds the search page for the airport's feeds.
 *
 * Flightradar24's streams carry an embedding condition: the attribution
 * sentence in `attribution` must appear, prominently, immediately adjacent
 * to the player, with a working link to their YouTube channel. The panel
 * renders it verbatim under the player — do not paraphrase or drop it when
 * editing entries.
 */

export interface SpottingAirport {
  /** ICAO code doubles as the id and the LiveATC lookup key. */
  icao: string;
  iata: string;
  airport: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  /** What the camera watches, in one line. */
  view: string;
  operator: string;
  /** YouTube video id of the 24/7 stream (verified live when catalogued). */
  videoId: string;
  channelId: string;
  channelName: string;
  /** Required embed attribution, verbatim, when the operator demands one. */
  attribution?: string;
  /** Extra official/viewing links worth one click. */
  links: { label: string; url: string }[];
  note?: string;
}

export const FR24_ATTRIBUTION =
  'This video was captured by an automatic tracking camera streaming live to the Flightradar24 YouTube channel.';

export function youtubeEmbedUrl(videoId: string): string {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&enablejsapi=1&rel=0`;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeChannelUrl(channelId: string): string {
  return `https://www.youtube.com/channel/${channelId}`;
}

/** LiveATC forbids embedding its audio — this is a link out, by design. */
export function liveAtcUrl(icao: string): string {
  return `https://www.liveatc.net/search/?icao=${icao}`;
}

export const SPOTTING_AIRPORTS: SpottingAirport[] = [
  {
    icao: 'KLAX',
    iata: 'LAX',
    airport: 'Los Angeles International',
    city: 'Los Angeles',
    country: 'United States',
    lat: 33.9416,
    lng: -118.4085,
    view: 'The H Hotel rooftop cameras over runways 24L/24R — heavies on final, all day and night',
    operator: 'Airline Videos Live',
    videoId: 'n4I0d44oBEs',
    channelId: 'UCox5yCEEjk4iYbhLgyj90EQ',
    channelName: 'Airline Videos Live',
    links: [{ label: 'Airline Videos Live — cameras & schedules', url: 'https://www.airlinevideos.com' }],
    note: 'The same crew runs hosted plane-spotting shows several days a week; the rooftop cameras themselves never stop.',
  },
  {
    icao: 'KLAS',
    iata: 'LAS',
    airport: 'Harry Reid International',
    city: 'Las Vegas',
    country: 'United States',
    lat: 36.0840,
    lng: -115.1537,
    view: 'An automated tracking camera that follows aircraft around the field, with tower audio in the stream',
    operator: 'Las Vegas Airport Live',
    videoId: 'K2Fqu7q2iV4',
    channelId: 'UCpWekERnJ3zwk-0gFlfursg',
    channelName: 'Las Vegas Airport Live',
    links: [],
    note: 'No separate ATC link needed for a first listen — the tower feed is mixed into this stream. LiveATC below carries the individual frequencies.',
  },
  {
    icao: 'EGLL',
    iata: 'LHR',
    airport: 'London Heathrow',
    city: 'London',
    country: 'United Kingdom',
    lat: 51.4700,
    lng: -0.4543,
    view: 'Myrtle Avenue, at the end of runway 27L — the famous spot where arrivals pass directly overhead',
    operator: 'Flightradar24',
    videoId: 'SgvpyjQX_HM',
    channelId: 'UCcGI_kXwKl_QhyW9jK_8gIA',
    channelName: 'Flightradar24',
    attribution: FR24_ATTRIBUTION,
    links: [{ label: 'Big Jet TV — hosted Heathrow shows', url: 'https://www.youtube.com/@bigjettv' }],
  },
  {
    icao: 'TNCM',
    iata: 'SXM',
    airport: 'Princess Juliana International',
    city: 'Maho Beach, Sint Maarten',
    country: 'Sint Maarten',
    lat: 18.0409,
    lng: -63.1089,
    view: 'Arrivals skimming Maho Beach on short final to runway 10 — the most famous airport approach on Earth',
    operator: 'Flightradar24 with ShowMe Caribbean',
    videoId: '2IQmpCXbOmM',
    channelId: 'UCcGI_kXwKl_QhyW9jK_8gIA',
    channelName: 'Flightradar24',
    attribution: FR24_ATTRIBUTION,
    links: [{ label: 'PTZtv Maho Beach Cam — its own player', url: 'https://mahobeachcam.com' }],
    note: 'The PTZtv camera is the other classic Maho view; it plays on its own site rather than YouTube, so it is a link, not an embed.',
  },
  {
    icao: 'LKPR',
    iata: 'PRG',
    airport: 'Václav Havel Airport',
    city: 'Prague',
    country: 'Czechia',
    lat: 50.1005,
    lng: 14.2632,
    view: 'Runway 06/24 from the spotting terrace, with the tower frequency carried in the stream',
    operator: 'Slow TV (Mall.tv)',
    videoId: 'Deo_lcwn8lk',
    channelId: 'UC3ewP9SczRIGGpDXDQvpPyQ',
    channelName: 'Slow TV',
    links: [{ label: "The airport's own plane-spotting guide", url: 'https://www.prg.aero/en/planespotting' }],
  },
];
