from __future__ import annotations

JPEG_SOI = b"\xff\xd8"
_JPEG_SOS = 0xDA
_APP1 = 0xE1
_APP13 = 0xED
_COM = 0xFE
_STANDALONE_MARKERS = {0xD8, 0xD9, *range(0xD0, 0xD8)}


def is_jpeg(data: bytes) -> bool:
    return len(data) >= 2 and data[:2] == JPEG_SOI


def strip_jpeg_metadata(data: bytes) -> bytes:
    if not is_jpeg(data):
        return data
    output = bytearray(data[:2])
    index = 2
    total = len(data)
    while index + 1 < total:
        if data[index] != 0xFF:
            break
        marker = data[index + 1]
        if marker == _JPEG_SOS:
            output += data[index:]
            return bytes(output)
        if marker in _STANDALONE_MARKERS:
            output += data[index : index + 2]
            index += 2
            continue
        if index + 4 > total:
            break
        segment_length = int.from_bytes(data[index + 2 : index + 4], "big")
        segment_end = index + 2 + segment_length
        if segment_end > total:
            break
        if marker not in (_APP1, _APP13, _COM):
            output += data[index:segment_end]
        index = segment_end
    return bytes(output)
