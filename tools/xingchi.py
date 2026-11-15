#!/usr/bin/env python3
"""Call the Xingchi provider (OpenAI-compatible chat completions) with gpt-6-astra."""
import json
import re
import sys
import urllib.request

CFG = '/root/.hermes/config.yaml'


def provider():
    raw = open(CFG).read()
    blk = re.search(r'\n  xingchi:\n((?:    .*\n)+)', raw).group(1)
    g = lambda k: (re.search(rf'{k}:\s*(.+)', blk).group(1).strip() if re.search(rf'{k}:\s*(.+)', blk) else None)
    return g('base_url').rstrip('/'), g('api_key')


def ask(prompt, model='gpt-6-astra', max_tokens=6000, temperature=0.2):
    base, key = provider()
    body = json.dumps({
        'model': model,
        'messages': [{'role': 'user', 'content': prompt}],
        'max_tokens': max_tokens,
        'temperature': temperature,
    }).encode()
    req = urllib.request.Request(base + '/chat/completions', data=body, headers={
        'Authorization': 'Bearer ' + key,
        'Content-Type': 'application/json',
    })
    with urllib.request.urlopen(req, timeout=600) as r:
        d = json.load(r)
    return d['choices'][0]['message']['content'], d.get('usage', {})


if __name__ == '__main__':
    path = sys.argv[1]
    model = sys.argv[2] if len(sys.argv) > 2 else 'gpt-6-astra'
    mx = int(sys.argv[3]) if len(sys.argv) > 3 else 6000
    text, usage = ask(open(path).read(), model, mx)
    print(text)
    print('\n--- tokens:', usage, file=sys.stderr)
