export interface ScrollMetrics {
    scrollHeight: number;
    clientHeight: number;
    scrollTop: number;
}

export const HELP_SCROLL_BOTTOM_THRESHOLD = 24;

export const shouldShowHelpScrollHint = (
    { scrollHeight, clientHeight, scrollTop }: ScrollMetrics,
    bottomThreshold = HELP_SCROLL_BOTTOM_THRESHOLD,
): boolean => (
    scrollHeight > clientHeight
    && scrollHeight - clientHeight - scrollTop > bottomThreshold
);
