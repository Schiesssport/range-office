// =============================================================================
// Match registration lookups and print-order pairing.
// =============================================================================

export const normalizeLabel = (value) => (value || '').trim().slice(0, 2);

const buildSingleMatchPairs = (participants, matches, matchKey) => {
    const match = matches.find((candidate) => candidate.key === matchKey);
    if (!match) return [];
    return participants
        .filter((participant) => participant.registeredMatches.includes(matchKey))
        .map((participant) => ({ participant, match }));
};

const buildAllMatchPairs = (participants, matches) => {
    const pairs = [];
    for (const participant of participants) {
        for (const match of matches) {
            if (participant.registeredMatches.includes(match.key)) {
                pairs.push({ participant, match });
            }
        }
    }
    return pairs;
};

export const buildPrintPairs = (participants, matches, matchKey = null) => {
    if (matchKey === null) return buildAllMatchPairs(participants, matches);
    return buildSingleMatchPairs(participants, matches, matchKey);
};

export const totalPrice = (registeredMatchKeys, matches) => {
    const registered = new Set(registeredMatchKeys);
    return matches.reduce(
        (sum, match) => registered.has(match.key) ? sum + (parseFloat(match.price) || 0) : sum,
        0,
    );
};
