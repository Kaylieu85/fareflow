#!/usr/bin/env python3
"""Bundle all binary assets under public/ into tools/assets-b64.json (text) for git-safe mirrors."""
import os, json, base64
out = {}
for root, _, files in os.walk('public'):
    for f in files:
        if f.lower().endswith(('.png','.jpg','.jpeg','.webp','.gif','.ico')):
            p = os.path.join(root, f).replace(os.sep,'/')
            out[p] = base64.b64encode(open(p,'rb').read()).decode()
json.dump(out, open('tools/assets-b64.json','w'))
print(len(out), 'assets ->', os.path.getsize('tools/assets-b64.json')//1024, 'KB')
