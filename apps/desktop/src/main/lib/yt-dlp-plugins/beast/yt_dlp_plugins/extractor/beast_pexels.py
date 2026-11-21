import json
from urllib.parse import urlparse

from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.utils import ExtractorError, float_or_none, int_or_none

__all__ = ['BeastPexelsIE']


class BeastPexelsIE(InfoExtractor):
    IE_NAME = 'beast:pexels'
    _VALID_URL = r'https?://(?:www\.)?pexels\.com/(?:[a-z]{2}(?:-[a-z]{2})?/)?video/(?:[^/?#]*-)?(?P<id>\d+)(?:[/?#]|$)'

    def _real_extract(self, url):
        video_id = self._match_id(url)
        webpage = self._download_webpage(url, video_id, impersonate=True)
        payload = self._search_regex(
            r'<script\b[^>]*\bid=["\x27]__NEXT_DATA__["\x27][^>]*>(.*?)</script>',
            webpage, 'Pexels video data', flags=16)
        data = json.loads(payload)
        medium = data.get('props', {}).get('pageProps', {}).get('medium', {})
        if str(medium.get('id')) != video_id:
            raise ExtractorError('The page did not expose the requested Pexels video', expected=True)
        attributes = medium.get('attributes', {})
        video = attributes.get('video', {})
        formats = []
        seen = set()
        for file in video.get('video_files') or []:
            link = file.get('link')
            if not isinstance(link, str) or link in seen:
                continue
            parsed = urlparse(link)
            if parsed.scheme != 'https' or parsed.hostname != 'videos.pexels.com':
                continue
            width, height = int_or_none(file.get('width')), int_or_none(file.get('height'))
            if not width or not height or file.get('file_type') != 'video/mp4':
                continue
            seen.add(link)
            fps = float_or_none(file.get('fps'))
            formats.append({
                'format_id': f'pexels-{width}x{height}-{fps or 0:g}',
                'url': link, 'ext': 'mp4', 'width': width, 'height': height,
                'fps': fps, 'vcodec': 'unknown',
                'format_note': (file.get('quality') or '').upper(),
            })
        if not formats:
            raise ExtractorError('Pexels did not expose downloadable resolutions for this video', expected=True)
        return {
            'id': video_id, 'title': (attributes.get('title') or f'Pexels {video_id}').strip(),
            'description': attributes.get('description'),
            'duration': float_or_none(attributes.get('duration')),
            'thumbnail': video.get('thumbnail', {}).get('large'),
            'formats': formats, 'webpage_url': url,
        }
