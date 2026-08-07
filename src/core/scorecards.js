// =============================================================================
// Scorecard field geometry: primary placement plus an optional paired copy.
// =============================================================================

export const fieldPlacements = (field) => {
    const primary = {
        fromLeftMm: field.fromLeftMm,
        fromTopMm: field.fromTopMm,
        widthMm: field.widthMm,
        heightMm: field.heightMm,
    };
    const placements = [primary];
    if (field.pair && field.pair.enabled) {
        placements.push({
            fromLeftMm: field.fromLeftMm + (field.pair.horizontalOffsetMm || 0),
            fromTopMm: field.fromTopMm + (field.pair.verticalOffsetMm || 0),
            widthMm: field.widthMm,
            heightMm: field.heightMm,
        });
    }
    return placements;
};
