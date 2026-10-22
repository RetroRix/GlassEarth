/**
 * Glass Earth — free ad-supported streaming TV (FAST) services.
 *
 * These are the big free television services: Pluto TV, Tubi, The Roku
 * Channel, Xumo Play, Sling Freestream. They sit beside the live-news
 * channels in the TV panel — but as *launchers*, deliberately.
 *
 * None of the five publishes an embed program a third-party site can use:
 * there is no supported iframe player for Pluto's live guide, Tubi's live
 * page, the Roku Channel, Xumo or Sling. The unofficial routes (ripping an
 * HLS URL out of their web players) break constantly and breach their terms.
 * So every entry here is a link out to the official service, which is the
 * arrangement that keeps working. The YouTube-live news channels in
 * /api/live-news are the embeddable part of the TV panel; these are the
 * channel-surfing part.
 *
 * This module is the single source of truth: the live-news API route serves
 * it as `services`, and the TV panel renders from that response.
 */

export interface FastService {
  id: string;
  name: string;
  /** What is on it, in one line. */
  tagline: string;
  /** The official live-TV entry point. */
  url: string;
  /** What watching costs, honestly stated. */
  note: string;
}

export const FAST_SERVICES: FastService[] = [
  {
    id: 'pluto',
    name: 'Pluto TV',
    tagline: 'Hundreds of live channels — news, movies, sport, classics',
    url: 'https://pluto.tv/live-tv',
    note: 'Free · no account',
  },
  {
    id: 'tubi',
    name: 'Tubi',
    tagline: 'Live news and entertainment channels over a huge free library',
    url: 'https://tubitv.com/live',
    note: 'Free · account optional',
  },
  {
    id: 'roku-channel',
    name: 'The Roku Channel',
    tagline: 'Live TV guide — news, film, series and Roku Originals',
    url: 'https://therokuchannel.roku.com',
    note: 'Free · runs in the browser, no Roku device needed',
  },
  {
    id: 'xumo',
    name: 'Xumo Play',
    tagline: 'Free live and on-demand channels, news to true crime',
    url: 'https://play.xumo.com',
    note: 'Free · no account',
  },
  {
    id: 'sling-freestream',
    name: 'Sling Freestream',
    tagline: "Sling's free tier — live channels without a subscription",
    url: 'https://watch.sling.com',
    note: 'Free · account optional',
  },
];
