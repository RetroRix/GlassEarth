import { describe, it, expect } from 'vitest';
import {
  decodeHtmlEntities, fingerprint, htmlToText, splitHeadline, stripSignOff,
} from './news-post';

describe('splitHeadline', () => {
  it('strips flags, emoji and decoration, and lifts the breaking label into a flag', () => {
    expect(splitHeadline('#BREAKING | 🇸🇪 — Sweden election too close to call\nMore to follow')).toEqual({
      headline: 'Sweden election too close to call', summary: 'More to follow', flag: 'BREAKING',
    });
  });

  it('drops the other house labels without flagging them', () => {
    expect(splitHeadline('— 🇮🇷 NEW: For the 200th consecutive night, sirens sounded').headline)
      .toBe('For the 200th consecutive night, sirens sounded');
  });

  it('skips lines that are only a label or a lone word', () => {
    const r = splitHeadline('📝ÚLTIMA HORA📝\nDnepropetrovsk\nStrikes reported on the city’s power grid overnight');
    expect(r.headline).toBe('Strikes reported on the city’s power grid overnight');
    expect(r.flag).toBe('BREAKING');
  });

  it('joins a speaker line to the quote beneath it', () => {
    expect(splitHeadline('Houthi Leader Abdul-Malik al-Houthi:\n\nWe will respond to any escalation.\n\nFull speech below').headline)
      .toBe('Houthi Leader Abdul-Malik al-Houthi: We will respond to any escalation.');
  });

  it('removes forwarding debris and unpaired guillemets', () => {
    expect(splitHeadline('Fwd from @ 📝«Cauldron near Volchansk📝').headline).toBe('Cauldron near Volchansk');
  });

  it('cuts a run-on first line at its first sentence', () => {
    const long = `The ministry said the talks would resume next week. ${'Further detail follows in a long paragraph. '.repeat(6)}`;
    const r = splitHeadline(long);
    expect(r.headline).toBe('The ministry said the talks would resume next week.');
    expect(r.summary.startsWith('Further detail')).toBe(true);
  });

  it('turns styled Unicode letters back into plain text', () => {
    expect(splitHeadline('𝗦𝘁𝗿𝗶𝗸𝗲 𝗼𝗻 𝘁𝗵𝗲 𝗽𝗼𝗿𝘁 confirmed').headline).toBe('Strike on the port confirmed');
  });
});

describe('stripSignOff', () => {
  it('drops the handles, menus and separators sources append', () => {
    expect(stripSignOff('Strikes hit the depot\n➖➖➖➖➖➖➖➖\n@BellumActaNews')).toBe('Strikes hit the depot');
    expect(stripSignOff('Strikes hit the depot\n➖➖➖➖➖➖➖\n💧 Rainbet.com the #1 Non-KYC Crypto Casino & Sportsbook @rainbetcom\n➖➖➖➖➖➖➖➖\n@BellumActaNews'))
      .toBe('Strikes hit the depot');
    expect(stripSignOff('Supply routes mapped\n#NATO #Russia #USA #Ukraine')).toBe('Supply routes mapped');
    expect(stripSignOff('Watch it live on TASS.\n🔴 @DDGeopolitics | Socials | Donate')).toBe('Watch it live on TASS.');
    expect(stripSignOff('Gerans on deployment\n👁@evropar — on the threshold of Europe’s death\n✉ VK | ✉ RuTube | ✉ OK | ✉ Zen\n💸Support us Original msg'))
      .toBe('Gerans on deployment');
  });

  it('keeps handles that are part of the report', () => {
    expect(stripSignOff('You can get the book on @ukr_leaks_analytics')).toBe('You can get the book on @ukr_leaks_analytics');
    expect(stripSignOff('@someone said the talks failed\nMore detail here')).toBe('@someone said the talks failed\nMore detail here');
  });
});

describe('text helpers', () => {
  it('decodes named, decimal and hex entities in one pass', () => {
    expect(decodeHtmlEntities('Russia&#39;s &quot;Geran&quot; &#x2014; 5&#33; &amp;lt;')).toBe('Russia\'s "Geran" — 5! &lt;');
  });

  it('leaves unknown entities alone', () => {
    expect(decodeHtmlEntities('&bogus; &#0;')).toBe('&bogus; &#0;');
  });

  it('collapses whitespace but keeps paragraph breaks', () => {
    expect(htmlToText('One&nbsp;&nbsp;two<br/><br/><br/>three')).toBe('One two\n\nthree');
  });

  it('fingerprints reposts identically despite emoji and links', () => {
    const base = 'Explosions reported near the Kherson rail junction';
    expect(fingerprint(`🇺🇦 ${base} https://t.me/x @someone`)).toBe(fingerprint(base));
    expect(fingerprint(base)).not.toBe(fingerprint('Explosions reported near the Odesa port'));
  });
});
