#!/usr/bin/env python3
"""测试视频 URL 编码问题"""
import urllib.parse
import http.client
import json
import time
import hashlib
import hmac

# 读取 SECRET_KEY 来生成有效 token
secret_file = '/Users/sanwang/file/file-server_重构/.secret_key'
with open(secret_file, 'r') as f:
    SECRET_KEY = f.read().strip()

def generate_token(username):
    ts = str(int(time.time()))
    msg = f"{username}.{ts}"
    sig = hmac.new(SECRET_KEY.encode(), msg.encode(), hashlib.sha256).hexdigest()[:32]
    return f"{msg}.{sig}"

token = generate_token('sanwangi')
print(f'Token: {token[:40]}...')

path = '动漫/我怎么能/[Sakurato] Watashi ga Koibito ni Nareru Wakenai jan, Muri Muri！（Muri ja Nakatta！？） [01][AVC-8bit 1080p AAC][CHS].mp4'

# Test 1: encodeURIComponent behavior (/ encoded as %2F)
encoded = urllib.parse.quote(path, safe='')
video_url = f'/video/{encoded}?token={token}'
print(f'\n=== Test 1: / encoded as %2F ===')
print(f'URL length: {len(video_url)}')

conn = http.client.HTTPConnection('localhost', 3002)
conn.request('GET', video_url, headers={'Range': 'bytes=0-1023'})
resp = conn.getresponse()
print(f'Status: {resp.status}')
ct = resp.getheader('Content-Type', 'N/A')
cl = resp.getheader('Content-Length', 'N/A')
print(f'Content-Type: {ct}')
print(f'Content-Length: {cl}')
if resp.status != 200:
    body = resp.read(300)
    print(f'Body: {body}')
else:
    data = resp.read(100)
    print(f'Got {len(data)} bytes of video data')

# Test 2: / NOT encoded (Python urllib default)
encoded2 = urllib.parse.quote(path)
video_url2 = f'/video/{encoded2}?token={token}'
print(f'\n=== Test 2: / not encoded ===')

conn2 = http.client.HTTPConnection('localhost', 3002)
conn2.request('GET', video_url2, headers={'Range': 'bytes=0-1023'})
resp2 = conn2.getresponse()
print(f'Status: {resp2.status}')
ct2 = resp2.getheader('Content-Type', 'N/A')
cl2 = resp2.getheader('Content-Length', 'N/A')
print(f'Content-Type: {ct2}')
print(f'Content-Length: {cl2}')
if resp2.status != 200:
    body2 = resp2.read(300)
    print(f'Body: {body2}')
else:
    data2 = resp2.read(100)
    print(f'Got {len(data2)} bytes of video data')

# Test 3: via Vite proxy (port 3001) with %2F encoding
print(f'\n=== Test 3: Via Vite proxy (3001) with %2F ===')
conn3 = http.client.HTTPConnection('localhost', 3001)
conn3.request('GET', video_url, headers={'Range': 'bytes=0-1023'})
resp3 = conn3.getresponse()
print(f'Status: {resp3.status}')
ct3 = resp3.getheader('Content-Type', 'N/A')
cl3 = resp3.getheader('Content-Length', 'N/A')
print(f'Content-Type: {ct3}')
print(f'Content-Length: {cl3}')
if resp3.status != 200:
    body3 = resp3.read(300)
    print(f'Body: {body3}')
else:
    data3 = resp3.read(100)
    print(f'Got {len(data3)} bytes of video data')
