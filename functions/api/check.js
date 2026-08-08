const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const DAY = 86_400_000;

export async function onRequestPost(context) {
  try {
    if (!context.env.YT_API_KEY) return json({ message: 'The checker is being configured. Please try again shortly.' }, 503);
    const body = await context.request.json().catch(() => ({}));
    const locator = parseChannelUrl(body.url);
    const cacheKey = `channel:v3:${locator.type}:${locator.value.toLowerCase()}`;
    const cached = await context.env.YT_CACHE?.get(cacheKey, 'json');
    if (cached) return json(cached, 200, { 'x-yppcheck-cache': 'HIT' });

    const channel = await resolveChannel(locator, context.env.YT_API_KEY);
    if (!channel) return json({ message: 'We could not find that channel. Check the URL and try again.' }, 404);
    const videos = await getRecentVideos(channel.contentDetails?.relatedPlaylists?.uploads, context.env.YT_API_KEY);
    const report = buildReport(channel, videos);
    await context.env.YT_CACHE?.put(cacheKey, JSON.stringify(report), { expirationTtl: 86_400 });
    return json(report, 200, { 'x-yppcheck-cache': 'MISS' });
  } catch (error) {
    if (error instanceof InputError) return json({ message: error.message }, 400);
    const reason = error?.reason || '';
    if (['quotaExceeded', 'dailyLimitExceeded', 'rateLimitExceeded'].includes(reason)) {
      return json({ message: 'YouTube’s API limit has been reached for today. Cached checks still work; please try this channel again later.' }, 429);
    }
    console.error('check_failed', error?.message || error);
    return json({ message: 'YouTube did not return channel data this time. Please wait a moment and try again.' }, 502);
  }
}

export function onRequestGet() {
  return json({ message: 'Send a POST request with a YouTube channel URL.' }, 405, { Allow: 'POST' });
}

class InputError extends Error {}

function parseChannelUrl(value) {
  if (typeof value !== 'string' || !value.trim()) throw new InputError('Paste a YouTube channel URL to begin.');
  let raw = value.trim();
  if (/^(www\.)?(youtube\.com|youtu\.be)\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new InputError('Enter a valid YouTube channel URL, such as youtube.com/@handle.'); }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['youtube.com', 'm.youtube.com'].includes(host)) throw new InputError('Use a youtube.com channel URL. Video links are not supported.');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (!parts.length) throw new InputError('This looks like the YouTube homepage, not a channel URL.');
  if (parts[0].startsWith('@') && parts[0].length > 1) return { type: 'handle', value: parts[0] };
  if (parts[0] === 'channel' && /^UC[\w-]{20,}$/.test(parts[1] || '')) return { type: 'id', value: parts[1] };
  if (parts[0] === 'c' && parts[1]) return { type: 'custom', value: parts[1] };
  throw new InputError('Supported formats are youtube.com/@handle, /channel/UC…, and /c/custom-name.');
}

async function resolveChannel(locator, key) {
  const part = 'snippet,statistics,contentDetails';
  if (locator.type === 'id') return first(await yt('/channels', { part, id: locator.value, key }));
  if (locator.type === 'handle') return first(await yt('/channels', { part, forHandle: locator.value, key }));

  const direct = first(await yt('/channels', { part, forHandle: locator.value, key }));
  if (direct && exactCustomMatch(direct, locator.value)) return direct;
  const legacy = first(await yt('/channels', { part, forUsername: locator.value, key }));
  if (legacy) return legacy;
  const search = await yt('/search', { part: 'snippet', type: 'channel', maxResults: '5', q: locator.value, key });
  const ids = (search.items || []).map(item => item.snippet?.channelId || item.id?.channelId).filter(Boolean);
  if (!ids.length) return direct || null;
  const candidates = (await yt('/channels', { part, id: ids.join(','), key })).items || [];
  return candidates.find(item => exactCustomMatch(item, locator.value)) || candidates.find(item => normalize(item.snippet?.title) === normalize(locator.value)) || direct || candidates[0] || null;
}

function exactCustomMatch(channel, value) {
  return normalize(channel.snippet?.customUrl) === normalize(value) || normalize(channel.snippet?.title) === normalize(value);
}

async function getRecentVideos(uploadsId, key) {
  if (!uploadsId) return [];
  const playlist = await yt('/playlistItems', { part: 'contentDetails', playlistId: uploadsId, maxResults: '50', key });
  const ids = (playlist.items || []).map(item => item.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return [];
  const response = await yt('/videos', { part: 'snippet,statistics,contentDetails', id: ids.join(','), key });
  return response.items || [];
}

async function yt(path, params) {
  const response = await fetch(`${API_ROOT}${path}?${new URLSearchParams(params)}`);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'YouTube API error');
    error.reason = payload.error?.errors?.[0]?.reason;
    throw error;
  }
  return payload;
}

function buildReport(channel, videos) {
  const now = Date.now();
  let watchHours = 0, shorts90 = 0, uploads90 = 0, monthlyViews = 0;
  const categories = new Map();
  for (const video of videos) {
    const published = new Date(video.snippet?.publishedAt || 0).getTime();
    const ageDays = Math.max(1, (now - published) / DAY);
    const views = Number(video.statistics?.viewCount || 0);
    const seconds = isoSeconds(video.contentDetails?.duration);
    const shortLike = seconds > 0 && seconds <= 180;
    if (ageDays <= 90) uploads90 += 1;
    if (shortLike && ageDays <= 90) shorts90 += views;
    if (!shortLike && ageDays <= 365) {
      const estimatedAverageSeconds = Math.min(480, Math.max(60, seconds * 0.35));
      watchHours += views * estimatedAverageSeconds / 3600;
    }
    if (ageDays <= 180) monthlyViews += views / Math.max(30, ageDays) * 30;
    const category = video.snippet?.categoryId;
    if (category) categories.set(category, (categories.get(category) || 0) + 1);
  }
  const stats = channel.statistics || {};
  const subscribers = Number(stats.subscriberCount || 0);
  const totalViews = Number(stats.viewCount || 0);
  monthlyViews = Math.round(Math.min(totalViews, monthlyViews));
  watchHours = Math.round(watchHours);
  const tier1 = subscribers >= 500 && uploads90 >= 3 && (watchHours >= 3000 || shorts90 >= 3_000_000);
  const tier2 = subscribers >= 1000 && (watchHours >= 4000 || shorts90 >= 10_000_000);
  const tier2Progress = Math.min(1, subscribers / 1000) * Math.max(Math.min(1, watchHours / 4000), Math.min(1, shorts90 / 10_000_000));
  const eligibility = tier2
    ? { code: 'likely', label: '✅ Likely Monetized', tier1, tier2 }
    : tier1 || tier2Progress >= 0.65
      ? { code: 'near', label: '⚠️ Near Threshold', tier1, tier2 }
      : { code: 'not', label: '❌ Not Eligible', tier1, tier2 };
  const categoryId = [...categories.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'general';
  const earnings = rpmFor(categoryId);
  const avatar = channel.snippet?.thumbnails?.high?.url || channel.snippet?.thumbnails?.default?.url || '';
  return {
    channel: { id: channel.id, name: channel.snippet?.title || 'YouTube channel', avatar, subscribers, subscribersHidden: Boolean(stats.hiddenSubscriberCount), videoCount: Number(stats.videoCount || 0), totalViews },
    estimates: { watchHours12Months: watchHours, shortsViews90Days: shorts90, publicUploads90Days: uploads90, monthlyViews, recentVideoSample: videos.length },
    eligibility,
    earnings,
    methodology: 'Recent public uploads sample; duration-based Shorts heuristic; modeled average view duration.',
    cachedAt: new Date().toISOString()
  };
}

function rpmFor(id) {
  const map = {
    '1': ['Film & Animation', 1.5, 5], '2': ['Autos & Vehicles', 2.5, 8], '10': ['Music', .8, 3], '15': ['Pets & Animals', 1.5, 5],
    '17': ['Sports', 1.5, 6], '19': ['Travel & Events', 2, 7], '20': ['Gaming', 1, 4], '22': ['People & Blogs', 1.5, 5],
    '23': ['Comedy', 1, 4], '24': ['Entertainment', 1.2, 5], '25': ['News & Politics', 2, 8], '26': ['How-to & Style', 2.5, 8],
    '27': ['Education', 3, 10], '28': ['Science & Technology', 4, 12], '29': ['Nonprofits & Activism', 1, 5]
  };
  const [niche, rpmLow, rpmHigh] = map[id] || ['General content', 1.5, 5];
  return { niche, rpmLow, rpmHigh };
}

function isoSeconds(value = '') {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  return match ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0) : 0;
}
function normalize(value = '') { return value.toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, ''); }
function first(payload) { return payload.items?.[0] || null; }
function json(body, status = 200, extra = {}) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } }); }
