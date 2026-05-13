#!/usr/bin/env python3
"""测试各种视频格式的预览能力"""
import subprocess, json, os, sys

BASE = '/Volumes/My Passport'

# 找一些不同格式的视频文件测试
test_cases = []

# 1. 用户提到的文件
test_cases.append({
    'name': 'MP4 (AVC-8bit)',
    'path': os.path.join(BASE, '动漫/我怎么能/[Sakurato] Watashi ga Koibito ni Nareru Wakenai jan, Muri Muri！（Muri ja Nakatta！？） [01][AVC-8bit 1080p AAC][CHS].mp4')
})

# 扫描一些不同格式的文件
for root, dirs, files in os.walk(os.path.join(BASE, '动漫')):
    dirs[:] = [d for d in dirs if not d.startswith('.')]
    for f in files:
        ext = f.rsplit('.', 1)[-1].lower() if '.' in f else ''
        if ext in ('mkv', 'avi', 'mov', 'webm', 'wmv', 'flv', 'ts'):
            fp = os.path.join(root, f)
            if os.path.getsize(fp) > 1024*1024:  # > 1MB
                test_cases.append({'name': f'{ext.upper()}: {f[:60]}', 'path': fp})
                break
    if len(test_cases) >= 6:
        break

# 也找一些 mp4
mp4_count = 0
for root, dirs, files in os.walk(os.path.join(BASE, '动漫')):
    dirs[:] = [d for d in dirs if not d.startswith('.')]
    for f in files:
        if f.lower().endswith('.mp4') and os.path.getsize(os.path.join(root, f)) > 10*1024*1024:
            fp = os.path.join(root, f)
            if fp != test_cases[0]['path']:
                test_cases.append({'name': f'MP4: {f[:60]}', 'path': fp})
                mp4_count += 1
                if mp4_count >= 2:
                    break
    if mp4_count >= 2:
        break

print(f'Found {len(test_cases)} test files\n')

for tc in test_cases:
    path = tc['path']
    name = tc['name']
    exists = os.path.exists(path)
    size = os.path.getsize(path) if exists else 0
    size_mb = size / (1024*1024)
    
    print(f'=== {name} ===')
    print(f'  Size: {size_mb:.1f} MB')
    print(f'  Exists: {exists}')
    
    if not exists:
        print(f'  SKIPPED - file not found\n')
        continue
    
    # ffprobe
    try:
        cmd = ['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
        if result.returncode == 0:
            data = json.loads(result.stdout)
            fmt = data.get('format', {})
            streams = data.get('streams', [])
            
            print(f'  Format: {fmt.get("format_long_name", "?")}')
            print(f'  Duration: {fmt.get("duration", "?")}s')
            
            for s in streams:
                ct = s.get('codec_type', '?')
                cn = s.get('codec_name', '?')
                idx = s.get('index', '?')
                extra = ''
                if ct == 'video':
                    extra = f' {s.get("width","?")}x{s.get("height","?")} {s.get("codec_long_name","")}'
                elif ct == 'audio':
                    tags = s.get('tags', {})
                    extra = f' lang={tags.get("language","?")}'
                elif ct == 'subtitle':
                    tags = s.get('tags', {})
                    extra = f' lang={tags.get("language","?")} title={tags.get("title","?")}'
                print(f'  Stream {idx}: {ct} - {cn}{extra}')
            
            subtitle_streams = [s for s in streams if s.get('codec_type') == 'subtitle']
            print(f'  Has subtitles: {len(subtitle_streams) > 0} ({len(subtitle_streams)} tracks)')
            
            # 测试浏览器兼容性
            video_streams = [s for s in streams if s.get('codec_type') == 'video']
            if video_streams:
                vcodec = video_streams[0].get('codec_name', '')
                # 浏览器原生支持的编解码器
                browser_ok = vcodec in ('h264', 'h265', 'hevc', 'vp8', 'vp9', 'av1')
                print(f'  Browser native support: {browser_ok} ({vcodec})')
                if vcodec in ('hevc', 'h265'):
                    print(f'  WARNING: HEVC/H.265 has limited browser support (Safari only)')
        else:
            print(f'  ffprobe FAILED: {result.stderr[:200]}')
    except subprocess.TimeoutExpired:
        print(f'  ffprobe TIMEOUT (15s)')
    except Exception as e:
        print(f'  Error: {e}')
    
    print()
