/** The class that colours a platform tag (tl-ios / tl-android / tl-cross for 跨平台 and anything else) */
export const platformClass = (p: string) => p === 'iOS' ? 'tl-ios' : p === 'Android' ? 'tl-android' : 'tl-cross';
