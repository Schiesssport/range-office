// =============================================================================
// UUIDv7 generation (RFC 9562) — time and randomness are caller-supplied.
// =============================================================================

const toHexByte = (byte) => byte.toString(16).padStart(2, '0');

const timestampBytes = (nowMs) => {
    const bytes = [];
    for (let shift = 40; shift >= 0; shift -= 8) {
        bytes.push(Math.floor(nowMs / 2 ** shift) % 256);
    }
    return bytes;
};

export const uuid7 = (nowMs, randomBytes) => {
    const bytes = [
        ...timestampBytes(nowMs),
        0x70 | (randomBytes[0] & 0x0f),
        randomBytes[1] & 0xff,
        0x80 | (randomBytes[2] & 0x3f),
        randomBytes[3] & 0xff,
        randomBytes[4] & 0xff,
        randomBytes[5] & 0xff,
        randomBytes[6] & 0xff,
        randomBytes[7] & 0xff,
        randomBytes[8] & 0xff,
        randomBytes[9] & 0xff,
    ];
    const hex = bytes.map(toHexByte).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
