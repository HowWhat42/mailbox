/** Video-meeting links we know how to join, most specific first. */
const PROVIDERS: [string, RegExp][] = [
  ['Teams', /https:\/\/teams\.(?:microsoft|live)\.com\/(?:l\/meetup-join|meet|dl\/launcher)\/[^\s"'<>]+/i],
  ['Google Meet', /https:\/\/meet\.google\.com\/[a-z]{3,}-[a-z]{3,}-[a-z]{3,}[^\s"'<>]*/i],
  ['Zoom', /https:\/\/(?:[\w-]+\.)*zoom\.us\/(?:j|my|w|s)\/[^\s"'<>]+/i],
  ['Webex', /https:\/\/(?:[\w-]+\.)*webex\.com\/(?:meet|join|[\w-]+\/j\.php)[^\s"'<>]*/i],
  ['Whereby', /https:\/\/whereby\.com\/[^\s"'<>]+/i],
  ['Jitsi', /https:\/\/meet\.jit\.si\/[^\s"'<>]+/i],
  ['GoTo', /https:\/\/(?:global\.gotomeeting\.com\/join|meet\.goto\.com)\/[^\s"'<>]+/i],
  ['Skype', /https:\/\/join\.skype\.com\/[^\s"'<>]+/i],
  ['Slack', /https:\/\/app\.slack\.com\/huddle\/[^\s"'<>]+/i],
  ['Discord', /https:\/\/discord\.(?:gg|com\/channels)\/[^\s"'<>]+/i]
]

export interface MeetingLink {
  url: string
  provider: string
}

/** First recognised meeting link in the given texts (location, description, …). */
export function findMeeting(...texts: (string | null | undefined)[]): MeetingLink | null {
  for (const [provider, re] of PROVIDERS) {
    for (const text of texts) {
      const m = text?.match(re)
      if (m) return { provider, url: m[0].replace(/[)\].,;>]+$/, '').replace(/&amp;/g, '&') }
    }
  }
  return null
}
