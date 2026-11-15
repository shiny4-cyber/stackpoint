import zlib, struct, sys

def png(path, w=1280, h=720, tint=(24, 30, 36)):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        for x in range(w):
            v = 6 + ((x * 18 // w) + (y * 10 // h))
            raw += bytes((min(255, tint[0] + v), min(255, tint[1] + v + 2), min(255, tint[2] + v + 4)))
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 6))
    out += chunk(b'IEND', b'')
    open(path, 'wb').write(out)
    print('wrote', path)

if __name__ == '__main__':
    for i, name in enumerate(sys.argv[1:]):
        png(name, tint=(20 + i * 8, 26 + i * 6, 34 + i * 4))
