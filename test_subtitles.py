#!/usr/bin/env python3
"""测试视频字幕提取"""
import subprocess, json, time

path = '/Volumes/My Passport/动漫/我怎么能/[Sakurato] Watashi ga Koibito ni Nareru Wakenai jan, Muri Muri！（Muri ja Nakatta！？） [01][AVC-8bit 1080p AAC][CHS].mp4'

start = time.time()
try:
    cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    elapsed = time.time() - start
    print(f'ffprobe elapsed: {elapsed:.2f}s')
    if result.returncode == 0:
        data = json.loads(result.stdout)
        subtitles = [s for s in data.get('streams', []) if s.get('codec_type') == 'subtitle']
        print(f'Subtitle tracks: {len(subtitles)}')
        for s in subtitles:
            tags = s.get('tags', {})
            print(f'  Index {s["index"]}: {s.get("codec_name")} lang={tags.get("language","?")} title={tags.get("title","?")}')
        
        all_streams = data.get('streams', [])
        print(f'\nAll streams ({len(all_streams)}):')
        for s in all_streams:
            codec_type = s.get('codec_type', '?')
            codec_name = s.get('codec_name', '?')
            index = s.get('index', '?')
            extra = ''
            if codec_type == 'video':
                extra = f'{s.get("width","?")}x{s.get("height","?")}'
            elif codec_type == 'audio':
                tags = s.get('tags', {})
                extra = f'lang={tags.get("language","?")}'
            elif codec_type == 'subtitle':
                tags = s.get('tags', {})
                extra = f'lang={tags.get("language","?")} title={tags.get("title","?")}'
            print(f'  Stream {index}: {codec_type} - {codec_name} {extra}')
    else:
        print(f'ffprobe error: {result.stderr}')
except Exception as e:
    print(f'Error: {e}')
