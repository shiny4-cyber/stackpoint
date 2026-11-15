#!/usr/bin/env python3
"""Call the AgentRouter gpt-6-astra model over the Responses API.

Usage: router.py <prompt-file> [--model gpt-6-astra] [--max 4000]
Reads the provider block from ~/.hermes/config.yaml (no key on the command line).
"""
import json
import re
import sys
import urllib.request

CFG = '/root/.hermes/config.yaml'


ENV_FILE = '/root/.hermes/credentials/agent/agentrouter.env'


def key_from_env(name):
    raw = open(ENV_FILE).read()
    m = re.search(rf'^{name}=(.*)$', raw, re.M)
    return m.group(1).strip() if m else None


def provider(name='agentrouter', key_name=None):
    raw = open(CFG).read()
    m = re.search(rf'{name}:\s*\n((?:\s{{4,}}.*\n)+)', raw)
    if not m:
        raise SystemExit(f'provider {name} not found in {CFG}')
    blk = m.group(1)

    def g(key):
        mm = re.search(rf'{key}:\s*(.+)', blk)
        return mm.group(1).strip() if mm else None

    key = key_from_env(key_name) if key_name else None
    headers = {'Authorization': 'Bearer ' + (key or g('api_key')), 'Content-Type': 'application/json'}
    ua = re.search(r'User-Agent:\s*(.+)', blk)
    if ua:
        headers['User-Agent'] = ua.group(1).strip()
    return g('base_url').rstrip('/'), headers


def ask(prompt, model='gpt-6-astra', max_tokens=4000, effort='low', key_name=None):
    base, headers = provider(key_name=key_name)
    body = json.dumps({
        'model': model,
        'input': prompt,
        'store': False,
        'max_output_tokens': max_tokens,
        'reasoning': {'effort': effort},
    }).encode()
    req = urllib.request.Request(base + '/responses', data=body, headers=headers)
    with urllib.request.urlopen(req, timeout=900) as r:
        d = json.load(r)
    out = []
    for item in d.get('output', []):
        for c in item.get('content', []):
            if c.get('type') == 'output_text':
                out.append(c.get('text', ''))
    return '\n'.join(out), d.get('usage', {})


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('usage: router.py <prompt-file> [--model M] [--max N]')
    prompt = open(sys.argv[1]).read()
    model = 'gpt-6-astra'
    mx = 4000
    effort = 'low'
    KEY = None
    args = sys.argv[2:]
    for i, a in enumerate(args):
        if a == '--model':
            model = args[i + 1]
        if a == '--max':
            mx = int(args[i + 1])
        if a == '--effort':
            effort = args[i + 1]
        if a == '--key':
            KEY = args[i + 1]
    text, usage = ask(prompt, model, mx, effort, KEY)
    print(text)
    print('\n--- tokens:', usage, file=sys.stderr)
