// =============================================================================
// Barcode payload construction: mod-97 checksum, program and participant codes.
// =============================================================================

export const computeChecksum = (digits) => {
    try {
        const n = BigInt(digits.replace(/\D/g, ''));
        let r = (n * -3n) % 97n;
        if (r < 0n) r += 97n;
        return r.toString().padStart(2, '0');
    } catch (_) {
        return '00';
    }
};

export const buildMatchCode = ({ codePrefix, matchCode, targetCode }) => {
    const r = (matchCode || '').trim();
    const t = (targetCode || '').trim();
    if (!r || !t) return null;
    const p = (codePrefix || '').padStart(2, '0');
    const base = p + r.padStart(3, '0') + t.padStart(3, '0');
    return base + computeChecksum(base);
};

export const buildParticipantCode = ({ prefix, license, enabled }) => {
    if (!enabled) return null;
    const digits = (license || '').replace(/\D/g, '');
    if (!digits) return null;
    const base = (prefix || '') + digits.padStart(6, '0');
    return base + computeChecksum(base);
};
