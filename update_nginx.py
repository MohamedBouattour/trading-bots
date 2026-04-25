import sys
import os

path = '/etc/nginx/sites-available/djmixer'
if not os.path.exists(path):
    print(f"File {path} not found!")
    sys.exit(1)

with open(path, 'r') as f:
    content = f.read()

import re
# Remove the existing location /bot/ block
content = re.sub(r'\s*# Trading Bot Dashboard\s*location /bot/ \{[\s\S]*?\}', '', content)

block = """
    # Trading Bot Dashboard
    location /bot/ {
        proxy_pass http://127.0.0.1:8081/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_buffering off;
    }
"""
content = content.replace('location / {', block + '    location / {')

with open(path, 'w') as f:
    f.write(content)
print("Updated /bot/ location with proxy_buffering off")
