/** Convert a video platform URL to an embeddable URL. Returns null if unsupported. */
export function getVideoEmbedUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");

    // Instagram Reels / Posts
    if (host === "instagram.com") {
      const match = u.pathname.match(/^\/(reel|p)\/([A-Za-z0-9_-]+)/);
      if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/embed/`;
    }

    // YouTube
    if (host === "youtube.com" || host === "m.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}?autoplay=1`;
      const shorts = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (shorts) return `https://www.youtube.com/embed/${shorts[1]}?autoplay=1`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (id) return `https://www.youtube.com/embed/${id}?autoplay=1`;
    }

    // TikTok
    if (host === "tiktok.com") {
      const match = u.pathname.match(/\/video\/(\d+)/);
      if (match) return `https://www.tiktok.com/embed/v2/${match[1]}`;
    }

    // Vimeo
    if (host === "vimeo.com") {
      const id = u.pathname.match(/^\/(\d+)/);
      if (id) return `https://player.vimeo.com/video/${id[1]}?autoplay=1`;
    }

    return null;
  } catch {
    return null;
  }
}

/** Check if a URL is from a known video platform */
export function isVideoUrl(url: string): boolean {
  return getVideoEmbedUrl(url) !== null;
}
