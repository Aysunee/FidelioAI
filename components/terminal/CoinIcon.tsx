import React, { useState } from 'react';

// Coin logo shared by the Terminal watchlist, symbol header and charts.

// Icons that failed once are never requested again during this session.
const failedIcons = new Set<string>();

// '1000PEPE' -> 'PEPE', '1MBABYDOGE' -> 'BABYDOGE', '1INCH' stays '1INCH'
const iconBase = (asset: string): string =>
    (asset || '?').toUpperCase().replace(/^(1000+|1M)(?=[A-Z])/, '');

const hueOf = (s: string): number => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % 360;
};

export interface CoinIconProps {
    asset: string;
    size?: number;
}

/** Binance logo for the base asset; falls back to a colored circle with the first letter. */
export const CoinIcon: React.FC<CoinIconProps> = React.memo(({ asset, size = 16 }) => {
    const base = iconBase(asset);
    const [failedBase, setFailedBase] = useState<string | null>(null);
    const failed = failedBase === base || failedIcons.has(base);

    if (failed) {
        return (
            <span
                aria-hidden="true"
                className="inline-flex items-center justify-center rounded-full text-white font-bold leading-none shrink-0 select-none"
                style={{
                    width: size,
                    height: size,
                    fontSize: Math.max(8, Math.round(size * 0.5)),
                    background: `hsl(${hueOf(base)} 55% 44%)`,
                }}
            >
                {base.charAt(0)}
            </span>
        );
    }

    return (
        <img
            src={`https://bin.bnbstatic.com/static/assets/logos/${base}.png`}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="rounded-full shrink-0 object-cover"
            style={{ width: size, height: size }}
            onError={() => {
                failedIcons.add(base);
                setFailedBase(base);
            }}
        />
    );
});
CoinIcon.displayName = 'CoinIcon';
